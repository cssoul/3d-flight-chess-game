import * as THREE from "three";
import { SCALE } from "../../game/theme";
import type { SceneDef, TileDef } from "../../game/scenes/types";
import { ISLAND, armDir, armOf } from "../../game/scenes/island";
import type { MaterialLibrary } from "../materials";
import { Batch, box, extrudeFlat, toMesh } from "../batch";
import { coastShape, grassR, sandR, soilR, wobblyHole } from "../coast";
import { createCheckered } from "../textures";
import { makeRandom, range } from "../rng";
import { collectCells, TileLayer } from "./shared";
import type { BoardView } from "./types";

/* ------------------------------------------------------------------ *
 *  版面尺度（全部从场景常量派生，不另立一套数字）
 * ------------------------------------------------------------------ */
const REACH = ISLAND.reach;
const HALF = ISLAND.half;
const TILE = ISLAND.tileSize;
/** 环道底衬外扩量 */
const D = TILE / 2 + 0.3;
/** 草地顶面 = 棋盘基准面 */
const TOP = SCALE.boardTop;
/**
 * 中央石台的底盘半径。
 * 上限由最内侧那块登顶道格挡着：格心在 reach − 5·CLIMB_STEP = 5.25，半宽 0.95，
 * 所以底盘最多到 4.3 —— 取 4.2 留 0.1 的余量。
 */
const CENTRE_R = 4.2;
/** 顶层十字台面的半宽与臂长（对角线半径 3.47，仍在底盘以内）；臂要窄，十字才读得出来 */
const CENTRE_HALF = 1.35;
const CENTRE_REACH = 3.2;

/* ------------------------------------------------------------------ *
 *  岛上的地形：小丘陵 + 一个小湖
 * ------------------------------------------------------------------ */

/**
 * 丘陵。位置不是随便挑的 —— 每条臂都是半宽 4.5、外扩后 5.75 的石板带，
 * 一条十字把岛切成四块，能放东西的只有四个象限里那一小片：
 * 需要 |x|、|z| 都大于 5.75 + 底盘半径（不然会压到石板带上），
 * 同时 底盘中心到原点的距离 + 底盘半径 < 17（不然会拱到沙滩上）。
 * 四个象限各占一个，湖占了其中一个，于是剩下三座丘陵。
 */
const HILLS: { x: number; z: number; r: number; tiers: number }[] = [
  { x: 9.7, z: 9.7, r: 2.9, tiers: 3 },
  { x: -9.9, z: 9.7, r: 2.5, tiers: 2 },
  { x: -10.0, z: -9.8, r: 2.5, tiers: 2 },
];

/** 岛上的小湖（参考图里那汪带木拱桥的池塘），占掉第四个象限 */
const LAKE = { x: 9.8, z: -9.8, r: 2.7 };

/** 垂柳种在最高那座丘陵的顶上 —— 和参考图里一样，树是长在台地上的 */
const WILLOW_HILL = 0;

/**
 * 丘陵的竖向尺度。
 *
 * **这三座丘陵是全场唯一不受棋盘限制的东西** —— 它们坐在十字石板带以外
 * 的四个象限里，头顶没有任何格块，所以想长多高都行。之前按"格块顶面只比
 * 草地高 0.16"的余量来限制它们，结果一圈土坎只有几厘米高，俯视下去就是
 * 草地上画了几个棕色圆环，完全读不出"丘陵"。
 * 现在一级土坎 0.32 打底、逐级递减，三级的丘顶能到草地上方 1.3 左右。
 */
const HILL_H = 0.32;
/** 每上一级，底盘半径收缩到多少 */
const HILL_TAPER = 0.7;
/**
 * 土坎的收分：一级土坎的顶盘半径 = 它的底盘半径 × 这个值。
 *
 * **这个数越接近 1 越像"崖"，越小越像"棕色垫子"** —— 收分大的时候土坎的顶面
 * 是一片缓坡，从上看下去它和侧壁同一个颜色，读出来就是草地上摊了一张棕色圆毯。
 * 收到 0.9 之后侧壁的法线接近水平，受光与水平的草皮明显不同，才读得出"一层崖"。
 */
const MOUND_TAPER = 0.9;

/**
 * 共享的单位体量。和 batch.ts 里的 UNIT_BOX 同一个套路：
 * 全场只留一份几何，复用不回收。
 *   UNIT_CYL   直筒（台面草皮）
 *   UNIT_MOUND 收分圆台（土坎）
 *   UNIT_DOME  半球（丘顶收圆）
 */
const UNIT_CYL = (() => {
  const g = new THREE.CylinderGeometry(1, 1, 1, 24);
  g.translate(0, 0.5, 0);
  return g;
})();
const UNIT_MOUND = (() => {
  const g = new THREE.CylinderGeometry(MOUND_TAPER, 1, 1, 26);
  g.translate(0, 0.5, 0);
  return g;
})();
const UNIT_DOME = new THREE.SphereGeometry(1, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2);

/**
 * 一座丘陵的施工图：每一级的底盘半径 / 高度 / 台面高度 / 台面半径，
 * 以及丘顶草帽的高度与总高。hill() 和散布树木都要用它，
 * 各算各的必然会错位（树就会飘在台面之上或陷进土里）。
 */
function hillPlan(r: number, tiers: number) {
  const list: { botR: number; topR: number; h: number; y: number; face: number }[] = [];
  let y = TOP;
  let rr = r;
  for (let k = 0; k < tiers; k++) {
    const h = HILL_H * (1 - k * 0.16);
    const topR = rr * MOUND_TAPER;
    list.push({ botR: rr, topR, h, y, face: y + 0.05 });
    y += h;
    rr *= HILL_TAPER;
  }
  const top = list[list.length - 1];
  const domeH = Math.min(0.5, top.topR * 0.45);
  return { list, topY: y, topR: top.topR, domeH, summit: y + domeH };
}

/* ------------------------------------------------------------------ *
 *  有机轮廓（岸线本身在 ../coast，棋盘与远景共用同一份）
 * ------------------------------------------------------------------ */

/**
 * 十字环道的石板带。挖洞与散布都要用到它 ——
 * 这条带子上除了格块以外什么都不许长（树、花、石头都不行）。
 */
function insidePath(x: number, z: number, margin: number) {
  const a = Math.abs(x);
  const b = Math.abs(z);
  const lim = HALF + D + margin;
  const tip = REACH + D + margin;
  return (a < lim && b < tip) || (b < lim && a < tip);
}

/** 十字轮廓（中央石台顶层用它） */
function plusPath(reach: number, half: number, target = new THREE.Shape()) {
  const pts: [number, number][] = [
    [half, reach], [-half, reach], [-half, half], [-reach, half], [-reach, -half],
    [-half, -half], [-half, -reach], [half, -reach], [half, -half], [reach, -half],
    [reach, half], [half, half],
  ];
  target.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) target.lineTo(pts[i][0], pts[i][1]);
  target.closePath();
  return target;
}

/**
 * 环形扇区（中央石台脚下的玩家色基座）。
 * extrudeFlat 会把 shape 的 +v 轴翻到世界 −z 上，所以世界角 aw 对应 shape 角 −aw。
 */
function wedgeShape(worldAngle: number, inner: number, outer: number, span = Math.PI / 2) {
  const a0 = -worldAngle - span / 2;
  const a1 = -worldAngle + span / 2;
  const s = new THREE.Shape();
  s.absarc(0, 0, outer, a0, a1, false);
  s.absarc(0, 0, inner, a1, a0, true);
  s.closePath();
  return s;
}

/** 臂号 → 该臂的几何信息 */
interface ArmInfo {
  arm: number;
  start: number;
  tile: TileDef;
  /** 由内向外（远离中心）的方向 */
  dir: { x: number; z: number };
  /** 该臂的世界方位角 */
  angle: number;
}

/** 占地圆：散布物件时用来避开丘陵 / 湖 / 中央石台 */
interface Blocker {
  x: number;
  z: number;
  r: number;
}

/**
 * 场景 B《云顶浮岛》的棋盘视图。
 *
 * 一座漂在碧水上的花园孤岛：起伏的岸线上长着草地、泥土层、宽窄不一的沙滩，
 * 草坡上有三座台地式的小丘陵和一个小湖（湖上架着木拱桥），
 * 石板十字环道绕岛一周，四条臂的端头各有一座起点木门，中央是三层石阶高台 + 风向鸟。
 *
 * 与城市场景最大的不同：这张盘上有「属于某个玩家」的构件（起点木门、登顶道、石台基座）。
 * 顶点色合批会把颜色烘死在几何里，所以这些构件必须每条臂各自成网 ——
 * 每条臂一组 + 一个 material，开局时 setSeatColors() 只改 material.color 就能整体换色。
 */
export class IslandBoard implements BoardView {
  group = new THREE.Group();

  private def: SceneDef;
  private mats: MaterialLibrary;
  private tiles: TileLayer;
  private arms: ArmInfo[] = [];
  private armMats: THREE.MeshStandardMaterial[] = [];
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  /** 风向鸟：绕着石柱慢慢转，一天转一圈 */
  private vane!: THREE.Group;
  /** 花丛的自发光：白天灭着，夜里当一地小灯 */
  private flowerMat!: THREE.MeshStandardMaterial;
  /** 蝴蝶：翅与身子各一个 InstancedMesh，逐帧改矩阵 */
  private wings: THREE.InstancedMesh | null = null;
  private bodies: THREE.InstancedMesh | null = null;
  private bugs: { home: THREE.Vector3; phase: number; r: number; h: number; speed: number; yaw: number }[] = [];
  /** 夜里的萤火 */
  private fireflies: THREE.Points | null = null;
  private fireMat: THREE.PointsMaterial | null = null;
  private t = 0;

  constructor(mats: MaterialLibrary, def: SceneDef) {
    this.mats = mats;
    this.def = def;
    this.group.name = "board";

    const step = def.tiles / 4;
    for (let arm = 0; arm < 4; arm++) {
      const start = arm * step;
      const dir = armDir(start);
      this.arms.push({
        arm,
        start,
        tile: def.ring[start],
        dir,
        angle: Math.atan2(dir.z, dir.x),
      });
    }

    this.buildGround();
    this.tiles = new TileLayer(def.tileSize, 0, "stone");
    this.tiles.add(collectCells(def));
    this.group.add(this.tiles.group);
    this.buildGarden();
    this.buildArms();
    this.buildCentre();
    this.setSeatColors([]);
  }

  /** 散布时要避开的所有占地圆：丘陵 + 湖 + 中央石台（石板带由 insidePath 单独判） */
  private blockers(): Blocker[] {
    const out: Blocker[] = [];
    for (const h of HILLS) out.push({ x: h.x, z: h.z, r: h.r + 0.5 });
    out.push({ x: LAKE.x, z: LAKE.z, r: LAKE.r + 0.9 });
    out.push({ x: 0, z: 0, r: CENTRE_R + 1.9 });
    return out;
  }

  private free(x: number, z: number, blocks: Blocker[], margin = 0) {
    if (insidePath(x, z, margin)) return false;
    for (const b of blocks) {
      const dr = b.r + margin;
      if ((x - b.x) * (x - b.x) + (z - b.z) * (z - b.z) < dr * dr) return false;
    }
    return true;
  }

  /* ---------------- 岛体：草地 → 土坎 → 沙滩 + 丘陵 + 小湖 ---------------- */

  /**
   * 三层叠出来的岛。顺序很关键：
   *   沙滩（最大、最低）→ 泥土（中间、略高）→ 草地（最小、最上）。
   * 于是从岸上看过去依次是：水面 → 一圈沙滩 → 泥土的立壁 → 草地。
   * 草地顶面必须正好落在 SCALE.boardTop，环道格块全部以此为基准。
   *
   * 三层的外缘半径各自独立（在 ../coast 里定义），而不是同一个函数乘三个系数 ——
   * 后者得到的三条曲线严格同心，滩肩与土坎的宽度绕着岛处处一样，一眼就假。
   */
  private buildGround() {
    const grass = new Batch();
    const shore = new Batch();
    const path = new Batch();

    /* 草地：顶面 = TOP。中间给湖挖一个洞，湖才是"陷进地里"的而不是贴在草皮上 */
    const grassShape = coastShape(grassR);
    grassShape.holes.push(wobblyHole(LAKE.x, LAKE.z, LAKE.r * 1.12));
    grass.add(extrudeFlat(grassShape, 0.14, TOP - 0.14), { color: "#7cc44f", uvScale: 4 });

    /* 沙滩 + 泥土层。泥土的洞比草地的洞更大，于是湖沿那一圈露出的是石砌，而不是土 */
    const sandShape = coastShape(sandR);
    const soilShape = coastShape(soilR);
    soilShape.holes.push(wobblyHole(LAKE.x, LAKE.z, LAKE.r * 1.34));
    shore.add(extrudeFlat(sandShape, 0.44, -0.38), { color: "#efe3c2", uvScale: 1.3 });
    shore.add(extrudeFlat(soilShape, 0.3, -0.105), { color: "#8a6444", uvScale: 1.6 });

    /* 小丘陵：台地式的草坡，跟参考图一样一层层往上收 */
    for (const h of HILLS) this.hill(grass, shore, h.x, h.z, h.r, h.tiers);

    /* 小湖：石砌湖沿。顶面比草地低 4cm，水面再低 6cm —— 草地 / 石沿 / 水面三级才读得出"陷下去" */
    path.add(extrudeFlat(this.lakeRim(LAKE.r), 0.16, TOP - 0.2), { pos: [LAKE.x, 0, LAKE.z], color: "#ded5c0", uvScale: 1.4 });

    /* 石板环道底衬：沿十字轮廓外扩/内缩出的那一圈，格块踩在上面才是"一条石路" */
    const band = plusPath(REACH + D, HALF + D);
    band.holes.push(plusPath(REACH - D, HALF - D));
    path.add(extrudeFlat(band, 0.024, TOP + 0.001), { color: "#cdc4b2", uvScale: 0.34 });

    const gm = toMesh(grass.build(), this.mats.lawn, "island-grass", false, true);
    if (gm) this.group.add(gm);
    const sm = toMesh(shore.build(), this.mats.sand, "island-shore", false, true);
    if (sm) this.group.add(sm);
    const pm = toMesh(path.build(), this.mats.flagstone, "island-paving", false, true);
    if (pm) this.group.add(pm);

    this.buildLake();
  }

  /**
   * 一座台地式丘陵：每一级都是"棕色收分土坎 + 顶上一圈浅绿草皮"，
   * 于是从侧面看是一道道土坎、从上面看是一圈圈收进去的草坪 —— 参考图里的那种丘陵。
   * 土坎和草皮分别并进 shore / grass 两个批次，不额外增加 draw call。
   *
   * 收分（MOUND_TAPER）是关键：直筒圆柱的剪影是一摞饼干，收分圆台才有"坡"。
   * 最后再扣一顶扁半球当丘顶，免得最高一级的直角口露出来。
   */
  private hill(grass: Batch, shore: Batch, x: number, z: number, r: number, tiers: number) {
    const plan = hillPlan(r, tiers);
    for (const t of plan.list) {
      shore.add(UNIT_MOUND, { pos: [x, t.y, z], scale: [t.botR, t.h, t.botR], color: "#a9724c" });
      // 台面：薄薄一片草皮，半径比土坎的顶盘再挑出 6cm —— 草压着崖顶，
      // 崖壁上留一条阴影，参考图里那几层台地就是这么读出来的
      const cr = t.topR + 0.06;
      grass.add(UNIT_CYL, { pos: [x, t.y - 0.05, z], scale: [cr, 0.1, cr], color: "#74bd48" });
    }
    grass.add(UNIT_DOME, {
      pos: [x, plan.topY - 0.03, z],
      scale: [plan.topR * 1.06, plan.domeH, plan.topR * 1.06],
      color: "#7cc44f",
    });
    return plan.summit;
  }

  /**
   * 湖沿：一圈石砌（局部坐标，靠 Batch 的 pos 平移到湖心）。
   * 外缘正好等于草地那个洞的半径 —— 石沿必须把洞填满，差一点就会露出下面的沙。
   * 内缘压到 0.94R，和半径 1.02R 的水面有一小段重叠，免得石沿和水之间裂出一道缝。
   */
  private lakeRim(r: number) {
    const s = new THREE.Shape();
    s.absarc(0, 0, r * 1.12, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, r * 0.94, 0, Math.PI * 2, true);
    s.holes.push(hole);
    return s;
  }

  /**
   * 小湖：石沿 + 水面 + 木拱桥 + 芦苇睡莲。
   * 水面刻意压到草地以下 7cm —— 配合草地那个洞，湖才真是"陷"进去的一汪水。
   */
  private buildLake() {
    const { x: cx, z: cz, r: R } = LAKE;
    const rand = makeRandom(8642);
    /** 水面高度：压在石沿（TOP−0.04）以下 6cm，也高于沙滩台面（0.06），不然会被地板吃掉 */
    const WATER = TOP - 0.1;

    /* 水面 */
    const waterGeo = new THREE.CircleGeometry(R * 1.02, 40);
    waterGeo.rotateX(-Math.PI / 2);
    this.pondMat = new THREE.MeshPhysicalMaterial({
      color: 0x9fdce8, roughness: 0.05, metalness: 0.08, envMapIntensity: 1.3,
    });
    const water = new THREE.Mesh(waterGeo, this.pondMat);
    water.position.set(cx, WATER, cz);
    water.receiveShadow = true;
    this.group.add(water);
    this.disposables.push(waterGeo, this.pondMat);

    /*
     * 木拱桥：桥板沿抛物线上抬，两端各一道护栏。
     *
     * **盒子的长边在 Z 上，所以 rotY 必须是 π/2 − bridgeYaw，不是 −bridgeYaw。**
     * Y 轴旋转 a 把 +Z 转到 (sin a, 0, cos a)，而桥轴方向是 (cos Y, 0, sin Y)；
     * 两者对齐要求 a = π/2 − Y。写成 −Y 的话桥面板还看不出问题（接近正方），
     * 但一道 5.6 米长的护栏会直接横过来 —— 湖面上就成了两根乱插的斜杠。
     */
    const bridgeYaw = Math.PI / 4 + 0.35;
    const wood = new Batch();
    const span = R * 2 + 0.6;
    const seg = 7;
    const rise = 0.24;
    /** 桥面基准：桥板底面正好落在草地顶面（TOP）上，两头才不是浮着的 */
    const base = TOP + 0.03;
    const bYaw = Math.PI / 2 - bridgeYaw;
    const along = (t: number, off = 0) => [
      cx + Math.cos(bridgeYaw) * t - Math.sin(bridgeYaw) * off,
      cz + Math.sin(bridgeYaw) * t + Math.cos(bridgeYaw) * off,
    ] as [number, number];

    for (let i = 0; i < seg; i++) {
      const t = (i / (seg - 1) - 0.5) * span;
      const y = base + Math.cos((t / span) * Math.PI) * rise;
      const [px, pz] = along(t);
      box(wood, [0.42, 0.06, span / seg + 0.04], [px, y, pz], "#c1904f", { rotY: bYaw });
    }
    for (const s of [-1, 1]) {
      // 护栏：沿桥轴贯通全桥，横向偏移半个桥宽（之前竖在桥墩上，两头都戳到岸上去了）
      const [rx, rz] = along(0, s * 0.24);
      box(wood, [0.06, 0.06, span - 0.4], [rx, base + 0.46, rz], "#a97a4c", { rotY: bYaw });
      for (const e of [-1, 1]) {
        const [px, pz] = along(e * (R - 0.1), s * 0.24);
        box(wood, [0.08, 0.42, 0.08], [px, base + 0.25, pz], "#8d6238");
      }
    }
    const wm = toMesh(wood.build(), this.mats.wood, "lake-bridge", true, true);
    if (wm) this.group.add(wm);

    // 芦苇 / 睡莲 / 莲花
    const dummy = new THREE.Object3D();
    const colr = new THREE.Color();
    const reeds: { x: number; z: number; s: number; rot: number }[] = [];
    for (let i = 0; i < 26; i++) {
      const a = rand() * 6.28;
      const rr = range(rand, R * 0.9, R * 1.18);
      const px = cx + Math.cos(a) * rr;
      const pz = cz + Math.sin(a) * rr;
      // 桥头两侧留口子，别把桥堵住
      if (Math.abs((px - cx) * Math.sin(bridgeYaw) - (pz - cz) * Math.cos(bridgeYaw)) < 0.5) continue;
      reeds.push({ x: px, z: pz, s: range(rand, 0.7, 1.35), rot: rand() * 6.28 });
    }
    const reedGeo = new THREE.CylinderGeometry(0.03, 0.045, 0.8, 5);
    reedGeo.translate(0, 0.4, 0);
    const reedMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    const reedMesh = new THREE.InstancedMesh(reedGeo, reedMat, reeds.length);
    reedMesh.castShadow = true;
    reeds.forEach((s, i) => {
      dummy.position.set(s.x, WATER - 0.02, s.z);
      dummy.rotation.set(0, s.rot, 0);
      dummy.scale.setScalar(s.s);
      dummy.updateMatrix();
      reedMesh.setMatrixAt(i, dummy.matrix);
      colr.setHSL(0.26, 0.4 + s.s * 0.08, 0.3 + s.s * 0.12);
      reedMesh.setColorAt(i, colr);
    });
    reedMesh.instanceMatrix.needsUpdate = true;
    if (reedMesh.instanceColor) reedMesh.instanceColor.needsUpdate = true;

    const padGeo = new THREE.CircleGeometry(0.32, 12);
    padGeo.rotateX(-Math.PI / 2);
    const padMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72 });
    const NP = 9;
    const padMesh = new THREE.InstancedMesh(padGeo, padMat, NP);
    for (let i = 0; i < NP; i++) {
      const a = rand() * 6.28;
      const rr = range(rand, 0.35, R * 0.8);
      dummy.position.set(cx + Math.cos(a) * rr, WATER + 0.005, cz + Math.sin(a) * rr);
      dummy.rotation.set(0, rand() * 6.28, 0);
      dummy.scale.setScalar(range(rand, 0.75, 1.3));
      dummy.updateMatrix();
      padMesh.setMatrixAt(i, dummy.matrix);
      colr.setHSL(0.29, 0.5, 0.42 + rand() * 0.12);
      padMesh.setColorAt(i, colr);
    }
    padMesh.instanceMatrix.needsUpdate = true;
    if (padMesh.instanceColor) padMesh.instanceColor.needsUpdate = true;

    const lotusGeo = new THREE.ConeGeometry(0.11, 0.16, 7);
    const NL = 4;
    const lotusMesh = new THREE.InstancedMesh(lotusGeo, padMat, NL);
    for (let i = 0; i < NL; i++) {
      const a = rand() * 6.28;
      const rr = range(rand, 0.4, R * 0.7);
      dummy.position.set(cx + Math.cos(a) * rr, WATER + 0.055, cz + Math.sin(a) * rr);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      lotusMesh.setMatrixAt(i, dummy.matrix);
      colr.set(i === 1 ? "#fff4f8" : "#f7a8c8");
      lotusMesh.setColorAt(i, colr);
    }
    lotusMesh.instanceMatrix.needsUpdate = true;
    if (lotusMesh.instanceColor) lotusMesh.instanceColor.needsUpdate = true;

    this.disposables.push(reedGeo, reedMat, padGeo, padMat, lotusGeo);
    this.group.add(reedMesh, padMesh, lotusMesh);
  }

  private pondMat!: THREE.MeshPhysicalMaterial;

  /* ---------------- 花园：树 / 花 / 芦苇 / 卵石 ---------------- */

  private buildGarden() {
    const blocks = this.blockers();
    const rand = makeRandom(20261015);

    /* ---- 树：三种树形共用两套几何，全部走 InstancedMesh ---- */
    const trunkGeo = new THREE.CylinderGeometry(0.09, 0.17, 1.25, 6);
    trunkGeo.translate(0, 0.62, 0);
    const crownGeo = new THREE.IcosahedronGeometry(0.88, 1);
    crownGeo.scale(1, 1.18, 1);
    crownGeo.translate(0, 1.78, 0);
    const coneGeo = new THREE.ConeGeometry(0.98, 1.5, 9);
    coneGeo.translate(0, 1.05, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0xa87f52, roughness: 0.92 });
    /**
     * 树冠 / 石 / 花的材质**不能**带 vertexColors。
     * mats.lawn、mats.rock、mats.accent 这些是给 Batch 用的（Batch 会把颜色烘成
     * color 属性），直接拿来建 InstancedMesh 时几何里没有 color 属性，着色器按
     * USE_COLOR 读到的就是 (0,0,0) —— 整片树冠、石头、花会全变成黑点。
     * 实例网格的颜色一律走 instanceColor，材质本身保持白。
     */
    const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86 });
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86 });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    const flowerMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.6, metalness: 0,
      emissive: new THREE.Color("#fff2c4"), emissiveIntensity: 0,
    });
    this.flowerMat = flowerMat;
    this.disposables.push(trunkGeo, crownGeo, coneGeo, trunkMat, crownMat, coneMat, rockMat, flowerMat);

    const spots: { x: number; z: number; y: number; s: number; rot: number; kind: number; c: number }[] = [];

    /* 丘陵上的树：跟参考图一样，树是长在台地上的 —— 这样岛上的剪影才有高低起伏 */
    for (const h of HILLS) {
      const plan = hillPlan(h.r, h.tiers);
      plan.list.forEach((t, k) => {
        // 最下一级台面太宽，留给下面那批散树；最高的那座丘顶站着垂柳，不跟它抢位置
        if (k === 0) return;
        if (h === HILLS[WILLOW_HILL] && k === plan.list.length - 1) return;
        const a = rand() * 6.28;
        const rr = t.topR * range(rand, 0, 0.35);
        spots.push({
          x: h.x + Math.cos(a) * rr, z: h.z + Math.sin(a) * rr, y: t.face,
          s: range(rand, 0.55, 0.9), rot: rand() * 6.28,
          kind: rand() > 0.7 ? 1 : 0, c: rand(),
        });
      });
    }

    for (let i = 0; i < 320 && spots.length < 46; i++) {
      const a = rand() * Math.PI * 2;
      // 树只长在草地上：上限跟着岸线走，不留神就会种到沙滩上去
      const r = range(rand, 6.6, grassR(a) * 0.93);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!this.free(x, z, blocks, 0.9)) continue;
      if (spots.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 4.2)) continue;
      // 云杉只长在几处，其余是阔叶树与灌木
      const kind = rand() > 0.8 ? 1 : 0;
      spots.push({ x, z, y: TOP, s: range(rand, 0.72, 1.5), rot: rand() * 6.28, kind, c: rand() });
    }

    const dummy = new THREE.Object3D();
    const colr = new THREE.Color();
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    trunks.castShadow = true;
    this.group.add(trunks);
    spots.forEach((s, i) => {
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, s.rot, 0);
      dummy.scale.set(s.s, s.s * range(rand, 0.9, 1.25), s.s);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
    });
    trunks.instanceMatrix.needsUpdate = true;

    const leafy = spots.filter((s) => s.kind === 0);
    const coni = spots.filter((s) => s.kind === 1);
    // 每棵阔叶树给两个球冠：主冠 + 一个偏出去的小冠，圆球感就碎了
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, leafy.length * 2);
    crowns.castShadow = true;
    crowns.receiveShadow = true;
    this.group.add(crowns);
    leafy.forEach((s, i) => {
      // 黄绿 → 深绿，花园里才不是一片同色的塑料球
      const hue = 0.24 + s.c * 0.07;
      const sat = 0.42 + s.c * 0.2;
      const lum = 0.28 + s.c * 0.14;
      dummy.position.set(s.x, s.y, s.z);
      dummy.rotation.set(0, s.rot, 0);
      dummy.scale.set(s.s * range(rand, 1.0, 1.3), s.s * range(rand, 0.85, 1.2), s.s * range(rand, 1.0, 1.3));
      dummy.updateMatrix();
      crowns.setMatrixAt(i * 2, dummy.matrix);
      colr.setHSL(hue, sat, lum);
      crowns.setColorAt(i * 2, colr);

      const oa = s.rot + range(rand, 2.0, 4.4);
      const orr = 0.55 * s.s;
      dummy.position.set(s.x + Math.cos(oa) * orr, s.y + 0.42 * s.s, s.z + Math.sin(oa) * orr);
      dummy.rotation.set(range(rand, -0.2, 0.2), s.rot + 1.2, 0);
      dummy.scale.setScalar(s.s * range(rand, 0.42, 0.68));
      dummy.updateMatrix();
      crowns.setMatrixAt(i * 2 + 1, dummy.matrix);
      colr.setHSL(hue + 0.012, sat, lum + 0.05);
      crowns.setColorAt(i * 2 + 1, colr);
    });
    crowns.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;

    // 云杉：三层锥体叠起来，用同一个 InstancedMesh 乘 3
    const cones = new THREE.InstancedMesh(coneGeo, coneMat, coni.length * 3);
    cones.castShadow = true;
    this.group.add(cones);
    coni.forEach((s, i) => {
      for (let k = 0; k < 3; k++) {
        dummy.position.set(s.x, s.y + k * 0.66 * s.s, s.z);
        dummy.rotation.set(0, s.rot + k * 0.4, 0);
        dummy.scale.set(s.s * (1.08 - k * 0.26), s.s * 0.8, s.s * (1.08 - k * 0.26));
        dummy.updateMatrix();
        cones.setMatrixAt(i * 3 + k, dummy.matrix);
        colr.setHSL(0.315 + s.c * 0.03, 0.44, 0.2 + k * 0.055);
        cones.setColorAt(i * 3 + k, colr);
      }
    });
    cones.instanceMatrix.needsUpdate = true;
    if (cones.instanceColor) cones.instanceColor.needsUpdate = true;

    // 垂柳：参考图里最有辨识度的那棵树，只种一棵 —— 立在最高那座丘陵的台顶上
    const wh = HILLS[WILLOW_HILL];
    this.buildWillow(wh.x, wh.z, 0.68, hillPlan(wh.r, wh.tiers).summit - 0.2);

    /* ---- 花丛：小多面体，颜色随机；夜里靠自发光当灯 ---- */
    const flowerGeo = new THREE.IcosahedronGeometry(0.115, 0);
    const flowerSpots: { x: number; z: number; s: number; c: number }[] = [];
    for (let i = 0; i < 1200 && flowerSpots.length < 230; i++) {
      const a = rand() * Math.PI * 2;
      const r = range(rand, 5.4, grassR(a) * 0.96);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // 花可以贴着路边长（margin 负值 = 允许压进格块的边）
      if (!this.free(x, z, blocks, -0.5)) continue;
      flowerSpots.push({ x, z, s: range(rand, 0.7, 1.4), c: rand() });
    }
    const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerSpots.length);
    const palette = ["#ffffff", "#ffe9a8", "#ff9f7a", "#f2c14e", "#e98fc4", "#cfe6ff"];
    this.group.add(flowers);
    flowerSpots.forEach((s, i) => {
      dummy.position.set(s.x, TOP + 0.11 * s.s, s.z);
      dummy.rotation.set(rand() * 3, rand() * 6.28, 0);
      dummy.scale.setScalar(s.s);
      dummy.updateMatrix();
      flowers.setMatrixAt(i, dummy.matrix);
      colr.set(palette[Math.floor(s.c * palette.length) % palette.length]);
      flowers.setColorAt(i, colr);
    });
    flowers.instanceMatrix.needsUpdate = true;
    if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;

    /* ---- 岸边的卵石：跟着岸线走，于是石头是沿滩散着的而不是排在一个圆上 ---- */
    const rockGeo = new THREE.IcosahedronGeometry(0.32, 0);
    const rockSpots: { x: number; z: number; s: number; c: number }[] = [];
    for (let i = 0; i < 700 && rockSpots.length < 42; i++) {
      const a = rand() * Math.PI * 2;
      const sr = sandR(a);
      const r = range(rand, sr * 0.84, sr * 1.0);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (!this.free(x, z, blocks, -1.4)) continue;
      rockSpots.push({ x, z, s: range(rand, 0.6, 1.9), c: rand() });
    }
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockSpots.length);
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    this.group.add(rocks);
    rockSpots.forEach((s, i) => {
      dummy.position.set(s.x, TOP - 0.14, s.z);
      dummy.rotation.set(rand() * 0.6, rand() * 6.28, rand() * 0.6);
      dummy.scale.set(s.s, s.s * range(rand, 0.5, 0.8), s.s);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
      colr.setHSL(0.09 + s.c * 0.05, 0.06 + s.c * 0.05, 0.44 + s.c * 0.2);
      rocks.setColorAt(i, colr);
    });
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;

    this.buildButterflies();
    this.buildFireflies();
  }

  /**
   * 垂柳：参考图里最抢眼的那棵树 —— 高杆顶着一大片垂下来的枝条。
   *
   * **树冠必须压匾、枝条必须挂在树冠外缘**。之前树冠是个半径 2.5 的球、枝条挂在
   * 半径 1.6~2.6 的位置上，整圈枝条全被球体吞掉了，远看就是一棵普通的圆头树，
   * 垂柳最该有的那道"帘子"完全没出来。
   * 现在树冠压成 1.9×0.78，枝条改从树冠外缘（1.5~2.2）往下垂，末端落到树冠以下。
   */
  private buildWillow(x: number, z: number, s: number, y0: number) {
    const b = new Batch();
    const trunk = new THREE.CylinderGeometry(0.17, 0.32, 3.0, 7);
    trunk.translate(0, 1.5, 0);
    b.add(trunk, { pos: [x, y0, z], scale: s, color: "#8a6a48" });

    const crown = new THREE.IcosahedronGeometry(1.9, 1);
    crown.scale(1.1, 0.78, 1.1);
    b.add(crown, { pos: [x, y0 + 2.95 * s, z], scale: s, color: "#9ad766" });
    const cap = new THREE.IcosahedronGeometry(1.25, 1);
    b.add(cap, { pos: [x - 0.25 * s, y0 + 3.45 * s, z + 0.22 * s], scale: s, color: "#a9e074" });

    // 枝条：几何体的 y=0 是顶端，往下长 —— 直接摆在树冠高度，长度决定垂到哪儿
    const strand = new THREE.CylinderGeometry(0.07, 0.045, 1, 5);
    strand.translate(0, -0.5, 0);
    const rand = makeRandom(555);
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2 + rand() * 0.14;
      const r = range(rand, 1.35, 2.2);
      const len = range(rand, 1.5, 3.1);
      b.add(strand, {
        pos: [x + Math.cos(a) * r * s, y0 + 2.85 * s, z + Math.sin(a) * r * s],
        scale: [s, len * s, s],
        rotZ: (rand() - 0.5) * 0.22,
        rotX: (rand() - 0.5) * 0.22,
        color: i % 3 === 0 ? "#8ecf5c" : "#9fd96a",
      });
    }
    this.disposables.push(trunk, crown, cap, strand);
    const mesh = toMesh(b.build(), this.mats.lawn, "willow", true, true);
    if (mesh) this.group.add(mesh);
  }

  /* ---------------- 蝴蝶 + 萤火 ---------------- */

  /**
   * 蝴蝶：翅与身子各一个 InstancedMesh，逐帧改实例矩阵。
   * 用实例而不是 8 个 Group 是为了把「翅 2 张 + 身子」压成 2 个 draw call ——
   * 花园里的装饰件已经很多了，动态小物件不能再按对象计费。
   */
  private buildButterflies() {
    const N = 9;
    const rand = makeRandom(4242);
    const wingGeo = new THREE.PlaneGeometry(0.26, 0.34);
    wingGeo.translate(0.13, 0, 0);
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.55, metalness: 0, side: THREE.DoubleSide,
      transparent: true, opacity: 0.96,
    });
    const bodyGeo = new THREE.CapsuleGeometry(0.035, 0.16, 3, 6);
    bodyGeo.rotateZ(Math.PI / 2);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x50423a, roughness: 0.7 });
    this.disposables.push(wingGeo, bodyGeo, wingMat, bodyMat);

    this.wings = new THREE.InstancedMesh(wingGeo, wingMat, N * 2);
    this.bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, N);
    this.wings.frustumCulled = false;
    this.bodies.frustumCulled = false;
    this.group.add(this.wings, this.bodies);

    const palette = ["#ffe27a", "#ff9f7a", "#ffffff", "#c9a8f0", "#8fd9e8", "#f7a8c8"];
    const colr = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const a = rand() * Math.PI * 2;
      const r = range(rand, 6.5, 15);
      this.bugs.push({
        home: new THREE.Vector3(Math.cos(a) * r, TOP + range(rand, 0.5, 1.3), Math.sin(a) * r),
        phase: rand() * 6.28,
        r: range(rand, 0.8, 2.1),
        h: range(rand, 0.35, 0.9),
        speed: range(rand, 0.45, 0.85),
        yaw: rand() * 6.28,
      });
      colr.set(palette[i % palette.length]);
      this.wings.setColorAt(i * 2, colr);
      this.wings.setColorAt(i * 2 + 1, colr);
    }
    if (this.wings.instanceColor) this.wings.instanceColor.needsUpdate = true;
  }

  /** 夜里的萤火虫：一片点云，白天整片透明 */
  private buildFireflies() {
    const N = 150;
    const rand = makeRandom(777);
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = rand() * Math.PI * 2;
      const r = range(rand, 4.5, grassR(a) * 0.95);
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = TOP + range(rand, 0.3, 2.6);
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.fireMat = new THREE.PointsMaterial({
      color: 0xffe9a0, size: 0.24, sizeAttenuation: true, transparent: true,
      opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.fireflies = new THREE.Points(geo, this.fireMat);
    this.fireflies.frustumCulled = false;
    this.disposables.push(geo, this.fireMat);
    this.group.add(this.fireflies);
  }

  /* ---------------- 四条臂各自的同色构件 ---------------- */

  private buildArms() {
    for (const a of this.arms) {
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        color: 0xffffff,
        roughness: 0.5,
        metalness: 0.06,
        envMapIntensity: 1.0,
      });
      this.armMats.push(mat);
      this.disposables.push(mat);

      const b = new Batch();

      /* --- 起点：贴地一圈起跑环 --- */
      const launch = new THREE.RingGeometry(TILE * 0.3, TILE * 0.47, 32);
      launch.rotateX(-Math.PI / 2);
      b.add(launch, { pos: [a.tile.x, SCALE.tileTop + 0.02, a.tile.z], color: "#ffffff" });

      /* --- 起点木门：两根立柱 + 上下两道横梁，像园林里的木牌坊 --- */
      const side = { x: -a.tile.tz, z: a.tile.tx };
      const off = TILE * 0.76;
      for (const s of [-1, 1]) {
        box(b, [0.17, 2.15, 0.17],
          [a.tile.x + side.x * off * s, SCALE.tileTop + 1.075, a.tile.z + side.z * off * s], "#ffffff");
        box(b, [0.3, 0.12, 0.3],
          [a.tile.x + side.x * off * s, SCALE.tileTop + 0.06, a.tile.z + side.z * off * s], "#ffffff");
      }
      box(b, [0.22, 0.2, off * 2 + 0.5],
        [a.tile.x, SCALE.tileTop + 2.2, a.tile.z], "#ffffff",
        { rotY: Math.atan2(side.x, side.z) });
      box(b, [0.16, 0.14, off * 2 + 0.2],
        [a.tile.x, SCALE.tileTop + 1.86, a.tile.z], "#ffffff",
        { rotY: Math.atan2(side.x, side.z) });

      /* --- 登顶道：比格块宽一点，于是格块两侧各露出一条同色边 --- */
      const laneEnd = CENTRE_R + 0.35;
      const laneLen = REACH + 0.55 - laneEnd;
      const mid = (REACH + 0.55 + laneEnd) / 2;
      box(b, [TILE * 1.14, 0.028, laneLen],
        [a.dir.x * mid, TOP + 0.034, a.dir.z * mid], "#ffffff",
        { rotY: Math.atan2(a.dir.x, a.dir.z) });

      /* --- 中央石台脚下的一圈同色基座 --- */
      b.add(extrudeFlat(wedgeShape(a.angle, CENTRE_R + 0.05, CENTRE_R + 0.82), 0.026, TOP + 0.02),
        { color: "#ffffff", uvScale: 1 });

      const mesh = toMesh(b.build(), mat, `island-arm-${a.arm}`, true, true);
      if (mesh) this.group.add(mesh);
    }
  }

  /* ---------------- 中央石台 + 风向鸟 ---------------- */

  private buildCentre() {
    const stone = new Batch();
    const light = new Batch();

    /**
     * 台基 → 圆台 → 十字台面，三级。
     *
     * 高度是被棋盘钉死的：草地 0.20、格块顶面 0.36，中间只有 0.16 可用，
     * 所以每一级只能分到 7~8cm —— 靠"每一级都带一圈深色立边 + 浅色台面"把这个落差读出来，
     * 而不是靠真正的层高。真正的竖向体量交给台顶那根风向鸟柱。
     */
    const step1 = 0.075;
    // 台基：最底下一圈深色裙边，让石台看起来是"砌"在地里的
    stone.add(new THREE.CylinderGeometry(CENTRE_R + 0.42, CENTRE_R + 0.5, 0.05, 44),
      { pos: [0, TOP + 0.025, 0], color: "#8e8570" });
    stone.add(new THREE.CylinderGeometry(CENTRE_R, CENTRE_R, step1, 44),
      { pos: [0, TOP + step1 / 2, 0], color: "#a2957c" });
    light.add(new THREE.CylinderGeometry(CENTRE_R - 0.16, CENTRE_R - 0.16, step1 + 0.01, 44),
      { pos: [0, TOP + step1 / 2 + 0.006, 0], color: "#e9e1cc" });

    // 顶层：十字石台，顶面正好落在 SCALE.tileTop，棋子登顶就站在这里
    const y = TOP + step1;
    const topH = SCALE.tileTop - y;
    const cross = plusPath(CENTRE_REACH, CENTRE_HALF);
    stone.add(extrudeFlat(cross, topH, y), { color: "#a89b82", uvScale: 0.9 });
    const crossIn = plusPath(CENTRE_REACH - 0.15, CENTRE_HALF - 0.15);
    light.add(extrudeFlat(crossIn, topH + 0.01, y), { color: "#f0e9d6", uvScale: 0.9 });

    const add = (bb: Batch, mat: THREE.Material, name: string) => {
      const mesh = toMesh(bb.build(), mat, name, true, true);
      if (mesh) this.group.add(mesh);
    };
    add(stone, this.mats.flagstone, "centre-stone");
    add(light, this.mats.flagstone, "centre-light");

    /* 台顶一块方格纹：这是终点，得有个不会看漏的记号 */
    const checkTex = createCheckered();
    checkTex.repeat.set(1, 4); // 8 列 × 2 行 → 贴到正方上正好 8×8 的棋盘格
    const checkMat = new THREE.MeshStandardMaterial({ map: checkTex, roughness: 0.8 });
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), checkMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = SCALE.tileTop + 0.008;
    pad.receiveShadow = true;
    this.group.add(pad);
    this.disposables.push(checkTex, checkMat, pad.geometry);

    /* --- 风向鸟：石柱 + 鸟，绕着柱子慢慢转 --- */
    this.vane = new THREE.Group();
    this.vane.position.set(0, SCALE.tileTop, 0);
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xbdb5a2, roughness: 0.86 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.55, metalness: 0.15 });
    this.disposables.push(stoneMat, darkMat);

    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.62, 0.24, 12), stoneMat);
    plinth.position.y = 0.12;
    plinth.castShadow = true;
    this.vane.add(plinth);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.15, 1.55, 10), stoneMat);
    col.position.y = 1.0;
    col.castShadow = true;
    this.vane.add(col);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.14, 0.16, 10), stoneMat);
    cap.position.y = 1.84;
    this.vane.add(cap);
    this.disposables.push(plinth.geometry, col.geometry, cap.geometry);

    // 鸟：身子 + 头 + 喙 + 双翅 + 尾羽，全是基础体量拼的
    const bird = new THREE.Group();
    bird.position.y = 2.02;
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), darkMat);
    body.scale.set(1, 0.82, 0.62);
    bird.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 9), darkMat);
    head.position.set(0, 0.2, 0.16);
    bird.add(head);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.24, 7), darkMat);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.19, 0.36);
    bird.add(beak);
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), darkMat);
      wing.scale.set(1.28, 0.14, 0.5);
      wing.position.set(s * 0.3, 0.06, -0.04);
      wing.rotation.z = s * 0.22;
      bird.add(wing);
    }
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 7), darkMat);
    tail.scale.set(1, 0.14, 0.62);
    tail.position.set(0, 0.02, -0.34);
    bird.add(tail);
    this.disposables.push(body.geometry, head.geometry, beak.geometry, tail.geometry);
    bird.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.vane.add(bird);
    this.group.add(this.vane);
  }

  /* ---------------- 对外接口 ---------------- */

  /**
   * 把四条臂的起点木门、登顶道与石台基座涂成玩家色。座位 → 臂的映射必须和场景的 starts() 一致，
   * 否则"我明明是紫电，木门却是金色的"。没人坐的臂退成灰。
   */
  setSeatColors(colors: string[]) {
    const assign = this.def.starts(Math.max(1, colors.length));
    const used = new Set<number>();
    assign.forEach((start, i) => {
      const arm = armOf(start);
      used.add(arm);
      this.armMats[arm]?.color.set(colors[i] ?? "#c8d2d8");
    });
    for (let arm = 0; arm < this.armMats.length; arm++) {
      if (!used.has(arm)) this.armMats[arm]?.color.set("#c8d2d8");
    }
  }

  pulse(start: number, pos: number, strength = 1) {
    this.tiles.pulse(this.def.cellKey(start, pos), strength);
  }

  focusAt(start: number, pos: number | null) {
    this.tiles.focus(pos === null ? null : this.def.cellKey(start, pos));
  }

  setHighlightColor(hex: string) {
    this.tiles.setHighlightColor(hex);
  }

  setTime(time: "day" | "night") {
    this.tiles.setTime(time);
    if (this.fireMat) this.fireMat.opacity = time === "night" ? 0.95 : 0;
    if (this.fireflies) this.fireflies.visible = time === "night";
    // 花在夜里微微发光：一批实例网格，改一个标量就全亮
    if (this.flowerMat) this.flowerMat.emissiveIntensity = time === "night" ? 0.8 : 0;
    // 湖水用的是独立材质，不跟着 mats 的夜色调走 —— 不自己压暗的话，
    // 棋盘全黑而只有这汪水亮着，像块贴错地方的灯箱
    this.pondMat.color.set(time === "night" ? "#3f6273" : "#9fdce8");
    this.pondMat.envMapIntensity = time === "night" ? 0.4 : 1.3;
  }

  update(dt: number) {
    this.t += dt;
    this.tiles.update(dt);
    // 风向鸟：一天一圈，慢慢转
    this.vane.rotation.y = this.t * 0.12;

    // 蝴蝶：沿一个椭圆绕着自己的落脚点飞，翅膀按正弦扇动
    if (this.wings && this.bodies) {
      const dummy = new THREE.Object3D();
      for (let i = 0; i < this.bugs.length; i++) {
        const g = this.bugs[i];
        const ph = this.t * g.speed + g.phase;
        const x = g.home.x + Math.cos(ph) * g.r;
        const z = g.home.z + Math.sin(ph * 0.8) * g.r;
        const y = g.home.y + Math.sin(ph * 1.7) * g.h;
        // 朝向下一个采样点，飞起来才不是横着平移
        const nx = g.home.x + Math.cos(ph + 0.12) * g.r;
        const nz = g.home.z + Math.sin((ph + 0.12) * 0.8) * g.r;
        const heading = Math.atan2(nx - x, nz - z) + g.yaw * 0.02;
        const flap = Math.sin(this.t * 13 + g.phase) * 0.95;
        for (let s = 0; s < 2; s++) {
          dummy.position.set(x, y, z);
          dummy.rotation.set(0, heading, s === 0 ? flap : -flap);
          dummy.scale.set(s === 0 ? 1 : -1, 1, 1);
          dummy.updateMatrix();
          this.wings.setMatrixAt(i * 2 + s, dummy.matrix);
        }
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, heading, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this.bodies.setMatrixAt(i, dummy.matrix);
      }
      this.wings.instanceMatrix.needsUpdate = true;
      this.bodies.instanceMatrix.needsUpdate = true;
    }

    // 萤火：慢慢往上飘 + 整体呼吸
    if (this.fireflies && this.fireflies.visible) {
      this.fireflies.position.y = Math.sin(this.t * 0.6) * 0.18;
      if (this.fireMat) this.fireMat.opacity = 0.6 + Math.sin(this.t * 1.9) * 0.32;
    }
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.tiles.dispose();
  }
}
