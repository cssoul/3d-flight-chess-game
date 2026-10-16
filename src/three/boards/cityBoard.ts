import * as THREE from "three";
import { SCALE } from "../../game/theme";
import type { SceneDef } from "../../game/scenes/types";
import { CITY_RING } from "../../game/scenes/city";
import type { MaterialLibrary } from "../materials";
import { Batch, box, extrudeFlat, roundedSquare, roundedSquareShape, toMesh } from "../batch";
import { createCheckered, createLabel } from "../textures";
import { makeRandom, range } from "../rng";
import { collectCells, pawnProfile, TileLayer } from "./shared";
import type { BoardView } from "./types";

/**
 * 场景 A《云顶都会》的棋盘视图：底板、48 格环道、中央园区、起点拱门、半程纪念碑。
 *
 * 格块本身（材质池 / 踩踏弹跳 / 高亮环）交给 TileLayer，这里只负责「这张棋盘特有的构件」。
 */
export class CityBoard implements BoardView {
  group = new THREE.Group();

  private def: SceneDef;
  private mats: MaterialLibrary;
  private tiles: TileLayer;
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private flagMesh!: THREE.Mesh;
  private flagBase!: Float32Array;
  private t = 0;

  constructor(mats: MaterialLibrary, def: SceneDef) {
    this.mats = mats;
    this.def = def;
    this.group.name = "board";

    this.buildPlate();
    this.tiles = new TileLayer(def.tileSize);
    this.tiles.add(collectCells(def));
    this.group.add(this.tiles.group);
    this.buildPark();
    this.buildStartArch();
    this.buildHalfway();
  }

  /* ---------------- 底板 ---------------- */
  private buildPlate() {
    const b = new Batch();
    const TOP = SCALE.boardTop;
    const plate = this.def.plate;

    // 深色包边：底板是"架在广场上的一张桌"，没有这一圈重色侧壁，
    // 白底板和白铺装会糊成一片，48 格环道也就失去了落脚的边界。
    const rimOuter = roundedSquareShape(plate.outer, 8.4);
    rimOuter.holes.push(roundedSquare(plate.outer - 0.62, 8.1));
    b.add(extrudeFlat(rimOuter, plate.height, 0), { color: "#93a0a9", uvScale: 2 });

    // 底板顶面必须正好落在 SCALE.boardTop，园区与格块全部以此为基准
    const shape = roundedSquareShape(plate.outer - 0.62, 8.1);
    b.add(extrudeFlat(shape, plate.height + 0.02, 0), { color: "#f5f8f9", uvScale: 1 });

    // 环道底衬：格块脚下的一圈浅灰"跑道"，让 48 块筹码看起来是铺在轨道上，
    // 而不是飘在白色底板上。圆角随外扩量同步增大，环道宽度才均匀。
    const d = this.def.tileSize / 2 + 0.24;
    const trackOuter = roundedSquareShape(CITY_RING.half + d, CITY_RING.corner + d);
    trackOuter.holes.push(roundedSquare(CITY_RING.half - d, CITY_RING.corner - d));
    b.add(extrudeFlat(trackOuter, 0.022, TOP + 0.001), { color: "#d9e0e4", uvScale: 2 });

    const mesh = toMesh(b.build(), this.mats.concrete, "board-plate", false, true);
    if (mesh) this.group.add(mesh);
  }

  /* ---------------- 中央园区 ---------------- */
  private buildPark() {
    const concrete = new Batch();
    const lawn = new Batch();
    const metal = new Batch();
    const accent = new Batch();

    const parkHalf = this.def.plate.inner - 0.2;
    const TOP = SCALE.boardTop;
    // 草地（顶面 0.30，比格块低 0.06，环道因此有清晰的"台沿"）
    const lawnShape = roundedSquareShape(parkHalf, 7.2);
    lawn.add(extrudeFlat(lawnShape, 0.1, TOP), { color: "#8ec37a", uvScale: 6 });
    // 环状林荫步道
    const parkPath = roundedSquareShape(parkHalf - 2.6, 6);
    parkPath.holes.push(roundedSquare(parkHalf - 4.2, 5.4));
    lawn.add(extrudeFlat(parkPath, 0.13, TOP - 0.01), { color: "#dde3e7", uvScale: 1 });

    // 中央圆广场
    const plaza = new THREE.Shape();
    plaza.absarc(0, 0, 5.4, 0, Math.PI * 2, false);
    const plazaRing = new THREE.Shape();
    plazaRing.absarc(0, 0, 5.0, 0, Math.PI * 2, false);
    plazaRing.absarc(0, 0, 4.4, 0, Math.PI * 2, true);
    concrete.add(extrudeFlat(plaza, 0.3, TOP), { color: "#eef1f4", uvScale: 1 });
    concrete.add(extrudeFlat(plazaRing, 0.34, TOP), { color: "#c8d1d8", uvScale: 1 });

    // 放射连接步道
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const len = 9.6;
      box(concrete, [1.8, 0.16, len], [Math.cos(a) * (len / 2 + 4.6), TOP + 0.08, Math.sin(a) * (len / 2 + 4.6)],
        "#dde3e7", { rotY: -a + Math.PI / 2, uvScale: 1 });
    }

    // 中央雕塑：锥柱 + 三道错落的环（压低体量，把空中留给骰子）
    const colGeo = new THREE.CylinderGeometry(0.42, 1.15, 3.4, 10);
    colGeo.translate(0, 1.7, 0);
    concrete.add(colGeo, { pos: [0, TOP + 0.3, 0], color: "#f6f9fb" });
    const ringGeo = new THREE.TorusGeometry(1.5, 0.13, 6, 22);
    for (let i = 0; i < 3; i++) {
      metal.add(ringGeo, {
        pos: [0, TOP + 1.05 + i * 0.88, 0],
        rotY: i * 0.7,
        rotX: Math.PI / 2 + (i - 1) * 0.34,
        color: "#dfe6ea",
      });
    }
    const capGeo = new THREE.IcosahedronGeometry(0.66, 1);
    metal.add(capGeo, { pos: [0, TOP + 3.95, 0], color: "#ffffff" });

    // 花坛：四组，低矮种植箱 + 彩色花点
    const rand = makeRandom(303);
    const flowerGeo = new THREE.IcosahedronGeometry(0.16, 0);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const bx = sx * 9.4;
      const bz = sz * 9.4;
      box(concrete, [3.0, 0.5, 3.0], [bx, TOP + 0.25, bz], "#e9edf0", { uvScale: 1 });
      for (let i = 0; i < 16; i++) {
        const colors = ["#ff8a6b", "#f2c14e", "#e07ab0", "#86d48a", "#7fb8e8"];
        accent.add(flowerGeo, {
          pos: [bx + range(rand, -1.1, 1.1), TOP + 0.58, bz + range(rand, -1.1, 1.1)],
          scale: range(rand, 0.8, 1.5),
          color: colors[Math.floor(rand() * colors.length)],
        });
      }
    }

    // 公园树 + 长椅
    const trunkGeo = new THREE.CylinderGeometry(0.1, 0.15, 1.0, 6);
    trunkGeo.translate(0, 0.5, 0);
    const crownGeo = new THREE.IcosahedronGeometry(0.78, 1);
    crownGeo.scale(1, 1.25, 1);
    crownGeo.translate(0, 1.5, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0xb9a68d, roughness: 0.9 });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86 });
    this.disposables.push(trunkMat, crownMat, trunkGeo, crownGeo);

    const spots: { x: number; z: number; s: number; c: number }[] = [];
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + rand() * 0.2;
      const r = i % 2 === 0 ? 7.6 : 10.6;
      spots.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, s: range(rand, 0.75, 1.15), c: rand() });
    }
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, spots.length);
    trunks.castShadow = true;
    crowns.castShadow = true;
    crowns.receiveShadow = true;
    const dummy = new THREE.Object3D();
    const colr = new THREE.Color();
    spots.forEach((s, i) => {
      dummy.position.set(s.x, TOP + 0.26, s.z);
      dummy.rotation.y = s.c * 6.28;
      dummy.scale.setScalar(s.s);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      crowns.setMatrixAt(i, dummy.matrix);
      colr.setHSL(0.265 + s.c * 0.05, 0.44 + s.c * 0.14, 0.42 + s.c * 0.09);
      crowns.setColorAt(i, colr);
    });
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    this.group.add(trunks, crowns);

    // 长椅：坐面长轴必须沿切线方向。rotY 用 a + π/2 才是切向——
    // 写成 -a 会让坐面沿半径向外、腿却按切向摆，变成一堆斜插在草地上的木板。
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      box(metal, [1.9, 0.16, 0.52], [Math.cos(a) * 6.4, TOP + 0.42, Math.sin(a) * 6.4], "#d9c7a6",
        { rotY: a + Math.PI / 2 });
      box(metal, [0.22, 0.42, 0.44], [Math.cos(a) * 6.4 + Math.sin(a) * 0.78, TOP + 0.21, Math.sin(a) * 6.4 - Math.cos(a) * 0.78], "#b98f5e");
      box(metal, [0.22, 0.42, 0.44], [Math.cos(a) * 6.4 - Math.sin(a) * 0.78, TOP + 0.21, Math.sin(a) * 6.4 + Math.cos(a) * 0.78], "#b98f5e");
    }

    const add = (bb: Batch, mat: THREE.Material, name: string, cast = true, receive = true) => {
      const m = toMesh(bb.build(), mat, name, cast, receive);
      if (m) this.group.add(m);
    };
    add(lawn, this.mats.lawn, "park-lawn", false, true);
    add(concrete, this.mats.concrete, "park-paving", false, true);
    add(metal, this.mats.metal, "park-metal", true, true);
    add(accent, this.mats.accent, "park-flower", false, true);
  }

  /* ---------------- 起点 / 终点拱门 ---------------- */
  private buildStartArch() {
    const start = this.def.ring[0];
    const yaw = Math.atan2(-start.tz, start.tx);
    const g = new THREE.Group();
    g.position.set(start.x, SCALE.tileTop, start.z);
    g.rotation.y = yaw;

    const white = new THREE.MeshStandardMaterial({ color: 0xf7f9fa, roughness: 0.7, metalness: 0.05 });
    const checkerTex = createCheckered();
    checkerTex.repeat.set(4, 1);
    const checker = new THREE.MeshStandardMaterial({ map: checkerTex, roughness: 0.7 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0x2e9bd6, roughness: 0.5, metalness: 0.1 });
    const labelTex = createLabel("START / FINISH", "起点 · 冲线", "#1FA2B8");
    const labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, toneMapped: false });
    this.disposables.push(white, checker, accentMat, labelMat, checkerTex, labelTex);

    const post = new THREE.BoxGeometry(0.34, 3.6, 0.34);
    post.translate(0, 1.8, 0);
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(post, white);
      m.position.z = s * 1.55;
      m.castShadow = true;
      g.add(m);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.7, 3.6), checker);
    beam.position.y = 3.25;
    beam.castShadow = true;
    g.add(beam);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 3.2), accentMat);
    base.position.y = 0.06;
    g.add(base);
    for (const s of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), accentMat);
      cap.position.set(0, 3.7, s * 1.55);
      g.add(cap);
    }
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 1.03), labelMat);
    banner.position.set(0, 4.35, 0);
    banner.rotation.y = Math.PI / 2;
    g.add(banner);
    this.disposables.push(post, beam.geometry, base.geometry, banner.geometry);

    this.group.add(g);
  }

  /* ---------------- 半程纪念碑（屏幕右上角的红旗台） ---------------- */
  private buildHalfway() {
    const tile = this.def.ring[this.def.halfway ?? 24];
    const outward = new THREE.Vector3(tile.nx, 0, tile.nz).normalize();
    const cx = tile.x + outward.x * 4.6;
    const cz = tile.z + outward.z * 4.6;
    const g = new THREE.Group();
    g.position.set(cx, 0.14, cz);

    const red = new THREE.MeshStandardMaterial({ color: 0xe2503f, roughness: 0.5, metalness: 0.08 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf7f9fa, roughness: 0.7, metalness: 0.05 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b3742, roughness: 0.6, metalness: 0.2 });
    this.disposables.push(red, white, dark);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.5, 0.62, 40), red);
    base.position.y = 0.31;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.1, 0.2, 40), white);
    top.position.y = 0.72;
    g.add(top);
    const groove = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.07, 6, 40), dark);
    groove.rotation.x = Math.PI / 2;
    groove.position.y = 0.84;
    g.add(groove);
    this.disposables.push(base.geometry, top.geometry, groove.geometry);

    // 巨型棋子（纪念碑主体，与玩家棋子同形）。
    // 轮廓瘦身之后（底半径 0.63 → 0.32），沿用原来的 2.05 缩放在 3.3 半径的台座上会显得太小，
    // 抬到 2.6 —— 底半径 0.83、总高 2.57，站在台上体量刚好。
    const pawn = new THREE.LatheGeometry(pawnProfile(), 28);
    const pawnMesh = new THREE.Mesh(pawn, white);
    pawnMesh.scale.setScalar(2.6);
    pawnMesh.position.y = 0.82;
    pawnMesh.castShadow = true;
    g.add(pawnMesh);
    this.disposables.push(pawn);

    // 旗杆 + 旗
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 7.2, 8);
    poleGeo.translate(0, 3.6, 0);
    const pole = new THREE.Mesh(poleGeo, dark);
    pole.position.y = 0.82;
    pole.castShadow = true;
    g.add(pole);
    const flagGeo = new THREE.PlaneGeometry(2.6, 1.6, 12, 5);
    const flagMat = new THREE.MeshStandardMaterial({
      color: 0xe2503f, roughness: 0.75, metalness: 0, side: THREE.DoubleSide,
    });
    this.flagMesh = new THREE.Mesh(flagGeo, flagMat);
    this.flagMesh.position.set(1.32, 6.0, 0);
    g.add(this.flagMesh);
    this.flagBase = (flagGeo.getAttribute("position") as THREE.BufferAttribute).array.slice() as Float32Array;
    this.disposables.push(poleGeo, flagGeo, flagMat);

    // 半程横幅
    const labelTex = createLabel("HALFWAY", "半 程 里 程 碑", "#E2503F", 512, 150);
    const labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, toneMapped: false });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 0.85), labelMat);
    board.position.set(0, 1.9, -3.15);
    board.rotation.y = Math.PI;
    g.add(board);
    const boardBack = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.95, 0.12), dark);
    boardBack.position.set(0, 1.9, -3.24);
    g.add(boardBack);
    this.disposables.push(labelMat, labelTex, board.geometry, boardBack.geometry);

    // 与环道之间的连接台
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.2, 4.4), white);
    ramp.position.set(-outward.x * 3.9, 0.1, -outward.z * 4.0);
    ramp.rotation.y = Math.atan2(-outward.z, outward.x) + Math.PI / 2;
    g.add(ramp);
    this.disposables.push(ramp.geometry);

    this.group.add(g);
  }

  /* ---------------- 对外接口 ---------------- */

  /** 城市场景没有"玩家专属"的棋盘构件，起点门的涂色是浮岛那边的事 */
  setSeatColors() {
    /* no-op */
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
  }

  update(dt: number) {
    this.t += dt;
    this.tiles.update(dt);

    // 旗帜飘动
    if (this.flagMesh) {
      const pos = this.flagMesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        const x = this.flagBase[i];
        const y = this.flagBase[i + 1];
        arr[i + 2] = Math.sin(x * 1.9 + this.t * 3.4) * 0.24 * (x + 1.3) * 0.55;
        arr[i + 1] = y + Math.sin(x * 2.4 + this.t * 3.4 + 0.6) * 0.06;
      }
      pos.needsUpdate = true;
      this.flagMesh.geometry.computeVertexNormals();
    }
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.tiles.dispose();
  }
}
