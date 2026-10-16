import * as THREE from "three";
import { Batch, box, extrudeFlat, roundedSquare, roundedSquareShape, toMesh, UNIT_BOX } from "./batch";
import type { MaterialLibrary } from "./materials";
import { makeRandom, range, type Rng } from "./rng";
import { createGroundTexture } from "./env";
import type { TimeOfDay } from "./env";

/* ------------------------------------------------------------------ *
 *  场地尺度：全部围绕「棋盘 + 环城路 + 街区」三层展开
 * ------------------------------------------------------------------ */

export const CITY = {
  plazaOut: 22.0,     // 广场外缘
  roadIn: 22.0,
  roadOut: 28.0,
  walkOut: 30.0,
  bandA: [32, 50] as [number, number],
  ave: [50, 58] as [number, number],
  bandB: [58, 76] as [number, number],
  groundSize: 420,
};

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  kind?: "build" | "park" | "pond" | "court" | "parking" | "tower";
  /** 指定层高即视为"地标体量"，会盖得更高更满 */
  floors?: number;
  /** 宽体量：横向铺满地块、进深压薄，用一栋"板楼"把天际线拉平 */
  wide?: boolean;
}

/** 圆角方环采样器（环城路车流用） */
function makeRing(half: number, radius: number) {
  const S = half - radius;
  const arc = (Math.PI * radius) / 2;
  const peri = 8 * S + 4 * arc;
  const at = (s: number) => {
    let t = s % peri;
    if (t < 0) t += peri;
    if (t <= S) return { x: t, z: half, tx: 1, tz: 0 };
    t -= S;
    if (t <= arc) return arcSeg(S, S, Math.PI / 2, 0, t, arc, radius);
    t -= arc;
    if (t <= 2 * S) return { x: half, z: S - t, tx: 0, tz: -1 };
    t -= 2 * S;
    if (t <= arc) return arcSeg(S, -S, 0, -Math.PI / 2, t, arc, radius);
    t -= arc;
    if (t <= 2 * S) return { x: S - t, z: -half, tx: -1, tz: 0 };
    t -= 2 * S;
    if (t <= arc) return arcSeg(-S, -S, -Math.PI / 2, -Math.PI, t, arc, radius);
    t -= arc;
    if (t <= 2 * S) return { x: -half, z: -S + t, tx: 0, tz: 1 };
    t -= 2 * S;
    if (t <= arc) return arcSeg(-S, S, Math.PI, Math.PI / 2, t, arc, radius);
    t -= arc;
    return { x: -S + t, z: half, tx: 1, tz: 0 };
  };
  return { peri, at };
}

function arcSeg(
  cx: number, cz: number, a0: number, a1: number, t: number, arcLen: number, radius: number,
) {
  const a = a0 + (a1 - a0) * (t / arcLen);
  const sign = a1 < a0 ? -1 : 1;
  return {
    x: cx + radius * Math.cos(a),
    z: cz + radius * Math.sin(a),
    tx: -Math.sin(a) * sign,
    tz: Math.cos(a) * sign,
  };
}

/* ------------------------------------------------------------------ *
 *  车辆
 * ------------------------------------------------------------------ */

interface Car {
  ring: number | null;
  s: number;
  speed: number;
  lane: number;
  fixed: { axis: "x" | "z"; at: number; from: number; to: number; dir: number } | null;
}

/* ------------------------------------------------------------------ *
 *  城市
 * ------------------------------------------------------------------ */

export class City {
  group = new THREE.Group();
  private mats: MaterialLibrary;
  private rng: Rng;
  private ring = makeRing(25, 7.5);
  private cars: Car[] = [];
  private carBody!: THREE.InstancedMesh;
  private carGlass!: THREE.InstancedMesh;
  private carShadow!: THREE.InstancedMesh;
  private shadowMat: THREE.MeshBasicMaterial;
  private groundMat: THREE.MeshStandardMaterial;
  private dummy = new THREE.Object3D();
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

  constructor(mats: MaterialLibrary, seed = 20261014) {
    this.mats = mats;
    this.rng = makeRandom(seed);

    // 底盘地面走"暖纸灰"，和广场/棋盘的纯白拉开一个色阶——
    // 白昼模式下这就是棋盘能被读出来的前提（白压白等于没有边界）。
    const groundTex = createGroundTexture("#f0ebe3", "#c2bdb3");
    this.disposables.push(groundTex);
    this.groundMat = new THREE.MeshStandardMaterial({
      map: groundTex,
      color: 0xffffff,
      roughness: 0.98,
      metalness: 0,
    });
    this.shadowMat = new THREE.MeshBasicMaterial({
      color: 0x8d9aa6,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });

    this.buildGround();
    this.buildPlaza();
    this.buildRoads();
    this.buildBlocks();
    this.buildTrees();
    this.buildLamps();
    this.buildCars();

    this.group.name = "city";
  }

  /* ---------- 大地面 ---------- */
  private buildGround() {
    const g = new THREE.PlaneGeometry(CITY.groundSize, CITY.groundSize);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, this.groundMat);
    m.position.y = -0.06;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    this.group.add(m);
    this.disposables.push(g);
  }

  /* ---------- 广场（棋盘外圈铺装） ---------- */
  private buildPlaza() {
    const b = new Batch();
    const outer = roundedSquareShape(CITY.plazaOut + 0.6, 9);
    const inner = roundedSquare(CITY.plazaOut - 6.4, 6.4);
    outer.holes.push(inner);
    b.add(extrudeFlat(outer, 0.14, 0), { color: "#d6dce1", uvScale: 1 });
    const mesh = toMesh(b.build(), this.mats.concrete, "plaza", false, true);
    if (mesh) this.group.add(mesh);

    // 广场上的环向石线：一圈浅浅的凹槽，纯装饰但很"建筑"
    const b2 = new Batch();
    const r1 = roundedSquareShape(CITY.plazaOut - 1.4, 7.4);
    const r2 = roundedSquare(CITY.plazaOut - 1.9, 7.1);
    r1.holes.push(r2);
    b2.add(extrudeFlat(r1, 0.16, 0), { color: "#c9d1d7" });
    const mesh2 = toMesh(b2.build(), this.mats.concrete, "plaza-groove", false, true);
    if (mesh2) this.group.add(mesh2);
  }

  /* ---------- 道路 ---------- */
  /**
   * 只保留环城路（圆角方环，外 28 / 内 22）。
   *
   * 原来还有四条从环城路放射到外圈的"大道"（半径 50~58 起，一路铺到 76）。
   * 那几条路两侧没有任何建筑，孤零零一条灰带穿过空地，读起来就是"几根多余的马路"——
   * 房子外围的马路已在需求里去掉，这里连同它们的中心虚线和路侧路灯一起删掉，
   * 环城路于是成为一条闭合环路，画面主体回到棋盘本身。
   */
  private buildRoads() {
    const b = new Batch();
    // 环城路：圆角方环（外 28 / 内 22）
    const ringOuter = roundedSquareShape(CITY.roadOut, 9.5);
    ringOuter.holes.push(roundedSquare(CITY.roadIn, 7.5));
    b.add(extrudeFlat(ringOuter, 0.06, 0), { color: "#b7bfc6", uvScale: 0.34 });

    const road = toMesh(b.build(), this.mats.road, "roads", false, true);
    if (road) this.group.add(road);

    // 中心虚线（白色短划线，抬高一点点避免 z-fighting）
    const d = new Batch();
    const dash = (x: number, z: number, len: number, alongX: boolean) => {
      const size: [number, number, number] = alongX ? [len, 0.02, 0.26] : [0.26, 0.02, len];
      box(d, size, [x, 0.075, z], "#f3f6f8");
    };
    for (let i = -40; i <= 40; i += 5.2) {
      const p = this.ring.at(i + 45);
      dash(p.x, p.z, 2.6, Math.abs(p.tx) > Math.abs(p.tz));
    }
    const dashMesh = toMesh(d.build(), this.mats.surface, "lane-marks", false, true);
    if (dashMesh) this.group.add(dashMesh);

    // 人行道：街区外圈的一圈浅色带
    const w = new Batch();
    const walkOuter = roundedSquareShape(CITY.walkOut, 9.5);
    walkOuter.holes.push(roundedSquare(CITY.roadOut, 9.5));
    w.add(extrudeFlat(walkOuter, 0.18, 0), { color: "#e9edf0", uvScale: 1 });
    const walk = toMesh(w.build(), this.mats.concrete, "sidewalk", false, true);
    if (walk) this.group.add(walk);
  }

  /* ---------- 街区 ---------- */
  /**
   * 广场外只有 10 块地：2 栋大地标 + 2 栋小体量（其中一栋是宽板楼），其余留成绿地 / 水景 / 球场。
   *
   * 旧做法是 bandA + bandB 两圈按 splits 递归切分，会生成 90+ 栋楼，
   * 从任何角度都把 48 格环道埋掉，画面主体变成"城市"而不是"棋盘"。
   *
   * 后来又砍到 6 栋，仍然偏挤偏满：房子的作用是给棋盘当一圈"体量背景"，
   * 一多就抢戏。现在再砍 2 栋（对应地块直接退成 park），并把整体压低一档，
   * 只留 4 栋；其中第 4 号地块做成横向铺满的宽板楼，避免四栋一样方。
   */
  private blocks(): Rect[] {
    // 半径 39：地块外缘 37.6 刚好压在人行道（walkOut 30）之外，
    // 是"不压马路"的下限；再近地标就会顶到画面下缘。
    const ring = makeRing(39, 16);
    const half = 7.6;
    const plan: { kind: Rect["kind"]; floors?: number; wide?: boolean }[] = [
      { kind: "build", floors: 4 },              // 地标 A（原 6 层，压低）
      { kind: "park" },
      { kind: "park" },                          // 原小体量 → 退成绿地（少第 1 栋）
      { kind: "build", floors: 3, wide: true },  // 宽板楼
      { kind: "pond" },
      { kind: "tower" },                         // 小蛮腰（替换原地标 B 的位置）
      { kind: "park" },                          // 原地标 B 地块退成绿地
      { kind: "park" },                          // 原小体量 → 退成绿地（少第 2 栋）
      { kind: "court" },
      { kind: "build", floors: 3 },              // 小体量
    ];
    const out: Rect[] = [];
    for (let i = 0; i < plan.length; i++) {
      const p = ring.at((ring.peri * (i + 0.5)) / plan.length);
      out.push({
        x0: p.x - half,
        z0: p.z - half,
        x1: p.x + half,
        z1: p.z + half,
        kind: plan[i].kind,
        floors: plan[i].floors,
        wide: plan[i].wide,
      });
    }
    return out;
  }

  private buildBlocks() {
    const white = new Batch();
    const glass = new Batch();
    const clear = new Batch();
    const roof = new Batch();
    const metal = new Batch();
    const lawn = new Batch();
    const water = new Batch();
    const accent = new Batch();

    const rects = this.blocks();
    // 地块用途已在 blocks() 里排好：2 地标 + 4 小体量 + 公园/水景/球场

    for (const r of rects) {
      const w = r.x1 - r.x0;
      const d = r.z1 - r.z0;
      // 地块地面：绿地（park/pond/court）铺草，其余一律铺浅色广场砖。
      // 之前 build 地块也铺草，楼直接压在草皮上，还悬空 0.2 —— 现在楼站在铺装上。
      const green = r.kind === "park" || r.kind === "pond" || r.kind === "court";
      lawn.add(UNIT_BOX, {
        pos: [(r.x0 + r.x1) / 2, 0.2, (r.z0 + r.z1) / 2],
        scale: [w - 0.6, 0.22, d - 0.6],
        color: green ? (r.kind === "court" ? "#b8d9a6" : "#a6cd90") : "#e2e7ea",
        uvScale: 4,
      });

      if (r.kind === "pond") {
        this.pond(water, lawn, r);
        // 和球场同一个毛病：水面半径 7~12，比地块半宽（7.6）还大，
        // 按地块撒的 10 棵树全都落在水里。连着球场那处一起去掉。
        continue;
      }
      if (r.kind === "court") {
        const g = new THREE.PlaneGeometry(w - 8, d - 8);
        g.rotateX(-Math.PI / 2);
        g.translate((r.x0 + r.x1) / 2, 0.34, (r.z0 + r.z1) / 2);
        const mesh = new THREE.Mesh(g, this.mats.court);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        this.group.add(mesh);
        this.disposables.push(g);
        // 球场本身不许长树（会插在草皮和球门框上），但周边一圈要留绿化 ——
        // 用 scatterAround 只在「场地边线以外」的位置种，球场不死白。
        this.scatterAround(r, 9, 4.6);
        continue;
      }
      if (r.kind === "parking") {
        const g = new THREE.PlaneGeometry(w - 7, d - 9);
        g.rotateX(-Math.PI / 2);
        g.translate((r.x0 + r.x1) / 2, 0.34, (r.z0 + r.z1) / 2);
        const mesh = new THREE.Mesh(g, this.mats.parking);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        this.group.add(mesh);
        this.disposables.push(g);
        this.scatterTrees(r, 8, 1.0);
        continue;
      }
      if (r.kind === "tower") {
        // 塔座：圆形铺装广场，塔立在铺装上（同样不压草地）
        const podium = new THREE.CylinderGeometry(6.9, 7.6, 0.9, 40);
        podium.translate((r.x0 + r.x1) / 2, 0.45, (r.z0 + r.z1) / 2);
        white.add(podium, { color: "#e6ebee", uvScale: 2 });
        this.cantonTower(
          (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2,
          metal, glass, accent,
        );
        // 塔脚下点几棵树，别让它孤零零立在一块灰砖上（圆形塔座半径 7.6，留 7.8 的禁区）
        this.scatterAround(r, 6, { kx: 5.2, kz: 5.2, circle: 7.8 });
        continue;
      }
      if (r.kind === "park") {
        this.scatterTrees(r, 14, 0.5);
        // 小径
        const b2 = new Batch();
        box(b2, [w - 6, 0.08, 2.2], [(r.x0 + r.x1) / 2, 0.36, (r.z0 + r.z1) / 2], "#dfe4e8", { uvScale: 1 });
        const m2 = toMesh(b2.build(), this.mats.concrete, "park-path", false, true);
        if (m2) this.group.add(m2);
        continue;
      }

      // ---- 常规街区：一块地 = 一栋楼（不再二次切分，地块本身已是楼体尺度）----
      const lots = this.splitRect(r, 0);
      let maxBw = 0;
      let maxBd = 0;
      for (const lot of lots) {
        const lw = lot.x1 - lot.x0;
        const ld = lot.z1 - lot.z0;
        // 整体再收一档：地标 0.84 → 0.7，小体量 0.58~0.74 → 0.5~0.64。
        // 地块是 15.2 见方、切完只剩 12，所以这里同时是"房子变小"的旋钮。
        const k = r.floors ? 0.7 : range(this.rng, 0.5, 0.64);
        // 宽板楼不吃比例，直接横向铺满地块、进深压薄。
        // 原来是横向 14 : 进深 6.2（长边沿 X）；按需求旋转 90°，长宽对调成
        // 横向 6.2 : 进深 14（长边沿 Z），天际线的走向换一个方向。
        const bw = r.wide ? 6.2 : lw * k;
        const bd = r.wide ? 14.0 : ld * k;
        const floors = r.floors ?? 2 + Math.floor(this.rng() * 4);
        this.building(
          white, glass, clear, roof, metal, accent,
          (lot.x0 + lot.x1) / 2,
          (lot.z0 + lot.z1) / 2,
          bw, bd, floors, r.wide === true,
        );
        maxBw = Math.max(maxBw, bw);
        maxBd = Math.max(maxBd, bd);
      }
      // 楼边的 3 棵行道树：只种在楼投影之外，别插在基座 / 裙房上
      this.scatterAround(r, 3, { kx: maxBw / 2 + 0.9, kz: maxBd / 2 + 0.9 });
    }

    const add = (b: Batch, mat: THREE.Material, name: string, cast = true) => {
      const m = toMesh(b.build(), mat, name, cast, true);
      if (m) this.group.add(m);
    };
    add(lawn, this.mats.lawn, "block-lawn", false);
    add(white, this.mats.surface, "buildings-white");
    add(glass, this.mats.glass, "buildings-glass", false);
    add(clear, this.mats.glassClear, "buildings-lobby", false);
    add(roof, this.mats.roof, "buildings-roof", false);
    add(metal, this.mats.metal, "buildings-metal");
    add(accent, this.mats.accent, "buildings-accent");
    add(water, this.mats.water, "pond-water", false);
  }

  private splitRect(r: Rect, depth: number): Rect[] {
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    const maxW = 20;
    const maxD = 20;
    if (depth > 2 || (w <= maxW && d <= maxD)) {
      const pad = 1.6;
      return [{ x0: r.x0 + pad, z0: r.z0 + pad, x1: r.x1 - pad, z1: r.z1 - pad }];
    }
    if (w > d) {
      const cut = r.x0 + w * range(this.rng, 0.4, 0.6);
      return [...this.splitRect({ x0: r.x0, z0: r.z0, x1: cut, z1: r.z1 }, depth + 1),
        ...this.splitRect({ x0: cut, z0: r.z0, x1: r.x1, z1: r.z1 }, depth + 1)];
    }
    const cut = r.z0 + d * range(this.rng, 0.4, 0.6);
    return [...this.splitRect({ x0: r.x0, z0: r.z0, x1: r.x1, z1: cut }, depth + 1),
      ...this.splitRect({ x0: r.x0, z0: cut, x1: r.x1, z1: r.z1 }, depth + 1)];
  }

  /** 一栋 SASAKI 式白色体量：楼板带 + 玻璃带 + 女儿墙 + 屋面设备 */
  private building(
    white: Batch, glass: Batch, clear: Batch, roof: Batch, metal: Batch, accent: Batch,
    cx: number, cz: number, w: number, d: number, floors: number, wide = false,
  ) {
    const fh = 3.4;
    const slab = 0.44;
    const baseY = 0.32;
    // 宽板楼不做裙房：它的横向已经铺满了，再叠一个 1.15~1.35 倍的裙房会越出地块。
    const podium = !wide && this.rng() > 0.55;
    const podiumH = podium ? fh : 0;
    const podiumW = w * range(this.rng, 1.15, 1.35);
    const podiumD = d * range(this.rng, 1.15, 1.35);

    if (podium) {
      box(white, [podiumW, podiumH + 0.4, podiumD], [cx, baseY + (podiumH + 0.4) / 2, cz], "#eef2f5", { uvScale: 1 });
      box(clear, [podiumW - 0.5, podiumH - 1.6, podiumD - 0.5], [cx, baseY + 0.9 + (podiumH - 1.6) / 2, cz], "#dff0f6");
    } else {
      // 落地基座：首层楼板底在 0.52、地面铺装顶在 0.31，中间原本悬空 0.2，
      // 楼看起来是"浮"在草地上。补一段矮基座把它接到地上。
      box(white, [w + 0.34, 0.34, d + 0.34], [cx, 0.35, cz], "#e9eef1", { uvScale: 1 });
    }

    const y0 = baseY + podiumH + 0.2;
    const setback = floors > 5 && this.rng() > 0.5;
    const cutAt = setback ? Math.max(2, Math.floor(floors * 0.6)) : floors;

    for (let f = 0; f < floors; f++) {
      const k = f < cutAt ? 1 : 0.72;
      const fw = w * k;
      const fd = d * k;
      const fy = y0 + f * fh;
      // 玻璃带
      box(glass, [fw, fh - slab, fd], [cx, fy + slab + (fh - slab) / 2, cz], "#a6d2e2");
      // 楼板带（略微出挑，是白色体量的关键）
      box(white, [fw + 0.34, slab, fd + 0.34], [cx, fy + slab / 2, cz], "#f6f9fb", { uvScale: 1 });
      if (f === cutAt - 1 && setback) {
        box(white, [w + 0.9, 0.5, d + 0.9], [cx, fy + slab + 0.25, cz], "#e9eef1", { uvScale: 1 });
      }
    }

    const topY = y0 + floors * fh;
    const tw = w * (setback ? 0.72 : 1);
    const td = d * (setback ? 0.72 : 1);
    // 女儿墙
    box(white, [tw + 0.5, 0.9, td + 0.5], [cx, topY + 0.45, cz], "#f6f9fb", { uvScale: 1 });
    box(roof, [tw - 0.1, 0.14, td - 0.1], [cx, topY + 0.9, cz], "#c6ccd1", { uvScale: 3 });
    // 屋面设备 + 桅杆
    const eq = 1 + Math.floor(this.rng() * 2);
    for (let i = 0; i < eq; i++) {
      const ew = tw * range(this.rng, 0.2, 0.4);
      const ed = td * range(this.rng, 0.2, 0.4);
      box(metal, [ew, 1.4, ed],
        [cx + (this.rng() - 0.5) * tw * 0.45, topY + 1.6, cz + (this.rng() - 0.5) * td * 0.45],
        "#b9c0c6");
    }
    if (this.rng() > 0.7) {
      box(metal, [0.18, 3.4, 0.18], [cx, topY + 2.4, cz], "#8f979e");
      box(accent, [0.4, 0.4, 0.4], [cx, topY + 4.2, cz], "#ff6a4d");
    }
  }

  /**
   * 小蛮腰（广州塔式）扭转格构塔。
   *
   * 用「双族直杆」造双曲面 —— 这正是冷却塔 / 广州塔的数学本质：直纹双曲面。
   * 把底部圆上的点用直线连到顶部圆上**错开一个扭角**的位置，这根直杆
   * 在中段自然离轴线最近；正反两族杆交叉，就得到标志性的斜向网格。
   * 收腰的深浅只由扭角决定（r0 与 r1 越接近、腰越靠半高），不用手调轮廓：
   *   r0=5.0 / r1=4.2 / twist=1.9rad → 腰径 2.68，出现在 56% 高度，比例 0.54。
   */
  private cantonTower(
    cx: number, cz: number,
    metal: Batch, glass: Batch, accent: Batch,
  ) {
    const H = 40;      // 塔身净高（不含天线）
    const r0 = 5.0;    // 底部半径
    const r1 = 4.2;    // 顶部半径
    const twist = 1.9; // 单向扭角（弧度）
    const N = 30;      // 每族斜柱数量
    const y0 = 0.9;    // 塔座顶面

    // 双曲面半径函数：高度比 t 处，直杆族包络到轴线的距离
    const c = Math.cos(twist);
    const radiusAt = (t: number) =>
      Math.sqrt(
        (1 - t) * (1 - t) * r0 * r0 + t * t * r1 * r1 + 2 * t * (1 - t) * r0 * r1 * c,
      );

    // 斜柱（两族交叉）
    const up = new THREE.Vector3(0, 1, 0);
    const strut = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    for (const dir of [1, -1]) {
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const A = new THREE.Vector3(cx + Math.cos(a) * r0, y0, cz + Math.sin(a) * r0);
        const B = new THREE.Vector3(
          cx + Math.cos(a + twist * dir) * r1, y0 + H, cz + Math.sin(a + twist * dir) * r1,
        );
        const axis = new THREE.Vector3().subVectors(B, A);
        const len = axis.length();
        const q = new THREE.Quaternion().setFromUnitVectors(up, axis.normalize());
        const g = strut.clone();
        g.applyMatrix4(
          new THREE.Matrix4().compose(
            new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5),
            q,
            new THREE.Vector3(0.11, len, 0.11),
          ),
        );
        metal.add(g, { color: "#eef2f5" });
      }
    }
    strut.dispose();

    // 环梁：把格构"箍"成楼层，也是塔身读出层数的关键
    for (const t of [0.08, 0.22, 0.36, 0.5, 0.64, 0.78, 0.92, 1]) {
      const ring = new THREE.TorusGeometry(radiusAt(t) + 0.06, 0.1, 5, 44);
      ring.rotateX(Math.PI / 2);
      ring.translate(cx, y0 + t * H, cz);
      metal.add(ring, { color: "#f6f9fb" });
    }

    // 内芯：半透玻璃筒 —— 格构后面得有"体量"，否则就是一圈空杆
    const corePts: THREE.Vector2[] = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      corePts.push(new THREE.Vector2(Math.max(0.05, radiusAt(t) * 0.86), t * H));
    }
    corePts.push(new THREE.Vector2(0.05, H));
    const core = new THREE.LatheGeometry(corePts, 28);
    core.translate(cx, y0, cz);
    glass.add(core, { color: "#cfe6f0" });

    // 顶部：观景层 + 天线桅杆 + 航空障碍灯
    const deck = new THREE.CylinderGeometry(r1 * 0.94, r1 * 0.8, 1.5, 32);
    deck.translate(cx, y0 + H + 0.75, cz);
    metal.add(deck, { color: "#f6f9fb" });
    const mast = new THREE.CylinderGeometry(0.16, 0.5, 11, 8);
    mast.translate(cx, y0 + H + 1.5 + 5.5, cz);
    metal.add(mast, { color: "#eef2f5" });
    const beacon = new THREE.SphereGeometry(0.5, 10, 8);
    beacon.translate(cx, y0 + H + 1.5 + 11 + 0.3, cz);
    accent.add(beacon, { color: "#ff5a4a" });
  }

  /** 只在地块边缘一圈撒树：场地（球场 / 水面）本身不许长树 */
  private scatterAround(
    r: Rect, n: number,
    keepOut: number | { kx: number; kz: number; circle?: number },
  ) {
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const kx = typeof keepOut === "number" ? keepOut : keepOut.kx;
    const kz = typeof keepOut === "number" ? keepOut : keepOut.kz;
    const circle = typeof keepOut === "number" ? 0 : keepOut.circle ?? 0;
    let placed = 0;
    // 拒绝采样：落在禁区内的点直接丢弃，最多试 n*14 次
    for (let i = 0; i < n * 14 && placed < n; i++) {
      const x = range(this.rng, r.x0 + 1.2, r.x1 - 1.2);
      const z = range(this.rng, r.z0 + 1.2, r.z1 - 1.2);
      if (Math.abs(x - cx) < kx && Math.abs(z - cz) < kz) continue;
      if (circle > 0 && Math.hypot(x - cx, z - cz) < circle) continue;
      this.treeSpots.push({
        x, z, y: 0.34,
        s: range(this.rng, 0.85, 1.2),
        c: this.rng(),
      });
      placed++;
    }
  }

  private pond(water: Batch, lawn: Batch, r: Rect) {
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const shape = new THREE.Shape();
    const rand = makeRandom(8181);
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = 9 + Math.sin(a * 3 + 1.2) * 1.9 + (rand() - 0.5) * 1.1;
      const x = cx + Math.cos(a) * rr * 1.25;
      const y = cz + Math.sin(a) * rr;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    water.add(extrudeFlat(shape, 0.08, 0.34), { color: "#ffffff", uvScale: 0.1 });
    // 岸边一圈铺装
    const outer = new THREE.Shape();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = 10.6 + Math.sin(a * 3 + 1.2) * 2.0;
      const x = cx + Math.cos(a) * rr * 1.25;
      const y = cz + Math.sin(a) * rr;
      if (i === 0) outer.moveTo(x, y);
      else outer.lineTo(x, y);
    }
    outer.closePath();
    lawn.add(extrudeFlat(outer, 0.16, 0.3), { color: "#cfd8dc", uvScale: 1 });
  }

  /* ---------- 树 ---------- */
  private treeSpots: { x: number; z: number; y: number; s: number; c: number }[] = [];

  private scatterTrees(r: Rect, n: number, jitter: number) {
    for (let i = 0; i < n; i++) {
      const x = range(this.rng, r.x0 + 2, r.x1 - 2);
      const z = range(this.rng, r.z0 + 2, r.z1 - 2);
      this.treeSpots.push({
        x: x + (this.rng() - 0.5) * jitter,
        z: z + (this.rng() - 0.5) * jitter,
        y: 0.34,
        s: range(this.rng, 0.85, 1.35),
        c: this.rng(),
      });
    }
  }

  private buildTrees() {
    // 沿环城路两侧的行道树（等距排布，是"城市感"的一半）
    // 外侧那排从 ±4.2 挪到 ±4.8（半径 29.2 → 29.8）：路灯现在站在 28.4 的人行道上，
    // 两者径向差从 0.8 拉到 1.4，树冠才不会把灯头吞掉。
    for (let t = 2; t < this.ring.peri; t += 7.5) {
      const p = this.ring.at(t);
      const nx = p.tz;
      const nz = -p.tx;
      for (const side of [1, -1]) {
        const off = side > 0 ? 4.2 : 4.8;
        this.treeSpots.push({
          x: p.x + nx * off * side,
          z: p.z + nz * off * side,
          y: 0.2,
          s: range(this.rng, 0.8, 1.2),
          c: this.rng(),
        });
      }
    }

    // 广场外圈的行道树（贴着棋盘底板，是画面前景最密的一层绿）
    // 间距从 6.4 放宽到 9.2：取景收紧后这一圈会顶到画面中部，
    // 太密就从"框住棋盘"变成"挡住棋盘"了。
    const plazaRing = makeRing(19.4, 6.6);
    for (let t = 0; t < plazaRing.peri; t += 9.2) {
      const p = plazaRing.at(t);
      this.treeSpots.push({
        x: p.x,
        z: p.z,
        y: 0.16,
        s: range(this.rng, 0.85, 1.25),
        c: this.rng(),
      });
    }

    // 广场四角的大树
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      for (let i = 0; i < 3; i++) {
        this.treeSpots.push({
          x: sx * (CITY.plazaOut - range(this.rng, 1.5, 4.5)),
          z: sz * (CITY.plazaOut - range(this.rng, 1.5, 4.5)),
          y: 0.16,
          s: range(this.rng, 1.05, 1.5),
          c: this.rng(),
        });
      }
    }

    const count = this.treeSpots.length;
    const trunkGeo = new THREE.CylinderGeometry(0.13, 0.2, 1.3, 6);
    trunkGeo.translate(0, 0.65, 0);
    const crownGeo = new THREE.IcosahedronGeometry(1.0, 1);
    crownGeo.scale(1, 1.2, 1);
    crownGeo.translate(0, 1.95, 0);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0xb9a68d, roughness: 0.9, metalness: 0 });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0 });
    this.disposables.push(trunkMat, crownMat, trunkGeo, crownGeo);

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, count);
    trunks.castShadow = true;
    crowns.castShadow = true;
    crowns.receiveShadow = true;

    const c = new THREE.Color();
    this.treeSpots.forEach((t, i) => {
      this.dummy.position.set(t.x, t.y, t.z);
      this.dummy.rotation.y = t.c * Math.PI * 2;
      this.dummy.scale.setScalar(t.s);
      this.dummy.updateMatrix();
      trunks.setMatrixAt(i, this.dummy.matrix);
      crowns.setMatrixAt(i, this.dummy.matrix);
      const mix = t.c;
      // 距离衰减：广场环以内的树是"棋盘的绿"，外圈的树逐渐褪成灰调鼠尾草。
      // 这是 SASAKI 那套"彩色棋盘 / 无色context"的核心手法——
      // 外圈抢色的绿会把人的注意力从棋格上拽走。
      const dist = Math.hypot(t.x, t.z);
      const k = Math.min(1, Math.max(0, (dist - 23) / 26));
      const sat = (0.44 + mix * 0.16) * (1 - k * 0.62);
      const lum = 0.42 + mix * 0.1 + k * 0.05;
      c.setHSL(0.265 + mix * 0.045 - k * 0.02, sat, lum);
      crowns.setColorAt(i, c);
    });
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    this.group.add(trunks, crowns);
  }

  /* ---------- 路灯 ---------- */
  private buildLamps() {
    const pole = new THREE.CylinderGeometry(0.09, 0.12, 3.6, 6);
    pole.translate(0, 1.8, 0);
    const arm = new THREE.BoxGeometry(0.14, 0.14, 1.0);
    arm.translate(0, 3.6, 0.45);
    const head = new THREE.SphereGeometry(0.24, 8, 6);
    head.translate(0, 3.5, 0.9);

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa3aa, roughness: 0.5, metalness: 0.6 });
    this.disposables.push(poleMat);

    /*
     * 位置修正：`this.ring.at()` 给出的是道路**中心线**（makeRing 的 half=25，
     * 而环城路是 22~28），所以原来把灯直接放在 p 上是把灯杆栽在了车道正中。
     * 现在沿"指向棋盘中心"的内侧法线往外退 3.4 —— 落在 28.4 的人行道（28~30）上，
     * 并且把灯臂转到朝内，灯头正好探在 27.9，即路面上方，是正常路灯的姿态。
     *
     * 注意 r 的算法也从 atan2(tx, tz) 改成了 atan2(nx, nz)：
     * 前者让灯臂顺着道路切向（灯头平行于路沿），后者才垂直于路沿。
     */
    const spots: { x: number; z: number; r: number }[] = [];
    for (let t = 3; t < this.ring.peri; t += 11) {
      const p = this.ring.at(t);
      const nx = p.tz;
      const nz = -p.tx;
      const off = -3.4;
      spots.push({ x: p.x + nx * off, z: p.z + nz * off, r: Math.atan2(nx, nz) });
    }
    // 放射大道已删，原来沿大道布的那一圈灯也一并去掉。

    const b = new Batch();
    b.add(pole, { pos: [0, 0, 0], color: "#cfd6dc" });
    b.add(arm, { pos: [0, 0, 0], color: "#cfd6dc" });
    const merged = b.build();
    const n = spots.length;
    const body = new THREE.InstancedMesh(merged!, poleMat, n);
    const glow = new THREE.InstancedMesh(head, this.mats.lampGlow, n);
    body.castShadow = true;
    this.disposables.push(merged!);
    spots.forEach((s, i) => {
      this.dummy.position.set(s.x, 0.2, s.z);
      this.dummy.rotation.set(0, s.r, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      body.setMatrixAt(i, this.dummy.matrix);
      glow.setMatrixAt(i, this.dummy.matrix);
    });
    body.instanceMatrix.needsUpdate = true;
    glow.instanceMatrix.needsUpdate = true;
    this.group.add(body, glow);
  }

  /* ---------- 车流 ---------- */
  private buildCars() {
    // 车身：一个带前后收分的低多边形体量
    const bodyGeo = new THREE.BoxGeometry(1.9, 0.62, 1.0);
    bodyGeo.translate(0, 0.52, 0);
    const nose = new THREE.BoxGeometry(0.7, 0.42, 0.96);
    nose.translate(1.05, 0.44, 0);
    const merged = new Batch();
    merged.add(bodyGeo, { color: "#ffffff" });
    merged.add(nose, { color: "#ffffff" });
    const carGeo = merged.build()!;
    this.disposables.push(carGeo);

    // 座舱：俯视时它是车上最显眼的一块，原来用 0x2a3b48 会读成一个"黑洞"，
    // 换成带反射的蓝灰玻璃色 + 收窄一点，车身白顶才露得出来。
    const canopy = new THREE.BoxGeometry(0.78, 0.42, 0.9);
    canopy.translate(-0.12, 1.0, 0);
    this.disposables.push(canopy);

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.35, envMapIntensity: 1.1 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x6b8496, roughness: 0.16, metalness: 0.5, envMapIntensity: 1.35 });
    this.disposables.push(bodyMat, glassMat);

    // 环城路上只留 2 辆车：有"活着的城市"的信号就够了，
    // 18 辆的环流在缩近的取景里会变成一圈抢眼的移动体。
    const N = 2;
    this.carBody = new THREE.InstancedMesh(carGeo, bodyMat, N);
    this.carGlass = new THREE.InstancedMesh(canopy, glassMat, N);
    this.carBody.castShadow = false;
    this.carBody.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.carGlass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const shadowGeo = new THREE.PlaneGeometry(2.6, 1.7);
    shadowGeo.rotateX(-Math.PI / 2);
    this.carShadow = new THREE.InstancedMesh(shadowGeo, this.shadowMat, N);
    this.carShadow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.disposables.push(shadowGeo);

    const palette = ["#eef2f5", "#8fb8d6"];
    const col = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const onRing = i < 11;
      const lane = i % 2 === 0 ? 25 - 1.7 : 25 + 1.7;
      this.cars.push(
        onRing
          ? { ring: lane, s: this.ring.peri * (i / N) + this.rng() * 8, speed: range(this.rng, 4.2, 6.8) * (i % 2 === 0 ? 1 : -1), lane, fixed: null }
          : {
              ring: null,
              s: 0,
              speed: 0,
              lane: 0,
              fixed: (() => {
                const c = i % 2 === 0 ? (CITY.ave[0] + CITY.ave[1]) / 2 : -((CITY.ave[0] + CITY.ave[1]) / 2);
                const axis = i % 4 < 2 ? "x" : "z";
                const dir = i % 2 === 0 ? 1 : -1;
                return { axis: axis as "x" | "z", at: c + (i % 3 - 1) * 1.9, from: -CITY.bandB[1], to: CITY.bandB[1], dir };
              })(),
            },
      );
      col.set(palette[i % palette.length]);
      this.carBody.setColorAt(i, col);
    }
    if (this.carBody.instanceColor) this.carBody.instanceColor.needsUpdate = true;
    this.group.add(this.carBody, this.carGlass, this.carShadow);
  }

  update(dt: number) {
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      if (car.ring !== null) {
        car.s += car.speed * dt;
        const p = this.ring.at(car.s);
        // 车道：沿外法线偏移 car.ring − 25
        const nx = p.tz;
        const nz = -p.tx;
        const x = p.x + nx * (car.ring - 25);
        const z = p.z + nz * (car.ring - 25);
        const yaw = Math.atan2(p.tx, p.tz) - Math.PI / 2 + (car.speed < 0 ? Math.PI : 0);
        this.dummy.position.set(x, 0.08, z);
        this.dummy.rotation.set(0, yaw, 0);
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        this.carBody.setMatrixAt(i, this.dummy.matrix);
        this.carGlass.setMatrixAt(i, this.dummy.matrix);
        this.dummy.position.set(x, 0.11, z);
        this.dummy.rotation.set(0, yaw, 0);
        this.dummy.updateMatrix();
        this.carShadow.setMatrixAt(i, this.dummy.matrix);
      } else if (car.fixed) {
        car.s += car.speed * dt;
        const f = car.fixed;
        const span = f.to - f.from;
        const t = (((car.s * 5 + i * 30) % span) + span) % span;
        const along = f.from + (f.dir > 0 ? t : span - t);
        const x = f.axis === "x" ? along : f.at;
        const z = f.axis === "x" ? f.at : along;
        const yaw = f.axis === "x" ? (f.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : f.dir > 0 ? 0 : Math.PI;
        this.dummy.position.set(x, 0.08, z);
        this.dummy.rotation.set(0, yaw, 0);
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        this.carBody.setMatrixAt(i, this.dummy.matrix);
        this.carGlass.setMatrixAt(i, this.dummy.matrix);
        this.dummy.position.set(x, 0.11, z);
        this.dummy.updateMatrix();
        this.carShadow.setMatrixAt(i, this.dummy.matrix);
      }
    }
    this.carBody.instanceMatrix.needsUpdate = true;
    this.carGlass.instanceMatrix.needsUpdate = true;
    this.carShadow.instanceMatrix.needsUpdate = true;
  }

  setTime(time: TimeOfDay) {
    this.shadowMat.opacity = time === "night" ? 0.45 : 0.28;
    this.shadowMat.color.set(time === "night" ? 0x000000 : 0x8d9aa6);
    this.groundMat.color.set(time === "night" ? "#4a5a70" : "#ffffff");
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        if (!this.disposables.includes(o.geometry)) o.geometry.dispose();
      }
    });
  }
}
