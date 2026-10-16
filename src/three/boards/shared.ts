import * as THREE from "three";
import { SCALE, type TileKind } from "../../game/theme";
import type { SceneDef, TrackPoint } from "../../game/scenes/types";
import { createTileTexture, type TileSurface } from "../textures";

/* ------------------------------------------------------------------ *
 *  棋子落地/停放的插槽偏移：同一格站多个棋子时不重叠
 * ------------------------------------------------------------------ */
export function slotOffset(slot: number, total: number, tangent: { tx: number; tz: number }) {
  if (total <= 1) return { x: 0, z: 0 };
  const r = total <= 2 ? 0.34 : total === 3 ? 0.42 : 0.5;
  const a = (slot / total) * Math.PI * 2 + Math.PI / 4;
  const along = Math.cos(a) * r;
  const across = Math.sin(a) * r;
  return {
    x: tangent.tx * along + tangent.tz * across,
    z: tangent.tz * along - tangent.tx * across,
  };
}

/**
 * 棋子轮廓（车床旋转体）—— 全场景共用，棋盘换了棋子不换。
 *
 * 造型按「经典小人」的比例来：球头 → 细颈 → 钟形身躯 → 带倒角的底座。
 * 关键是把「头 / 颈 / 身 / 底座」四段分出来：
 *
 *   底 座  y 0.00–0.10  r 0.32 → 微收，顶面留一圈台阶
 *   身 躯  y 0.10–0.56  贝塞尔式外扩，到底部最宽
 *   颈    y 0.56–0.65  最细处 r 0.126，头身之间才有"脖子"
 *   球 头  y 0.65–1.00  圆心 y 0.815，半径 0.19
 */
export function pawnProfile(): THREE.Vector2[] {
  const pts: [number, number][] = [
    [0.0, 0.0], // 底心
    [0.3, 0.0], // 平底
    [0.322, 0.016],
    [0.328, 0.044],
    [0.32, 0.072],
    [0.3, 0.104],
    [0.278, 0.15],
    [0.256, 0.204],
    [0.232, 0.268],
    [0.208, 0.334],
    [0.184, 0.4],
    [0.162, 0.46],
    [0.144, 0.516],
    [0.13, 0.564],
    [0.124, 0.6], // 颈最细
    [0.126, 0.638],
    [0.138, 0.672],
    [0.158, 0.706],
    [0.176, 0.74],
    [0.187, 0.778],
    [0.19, 0.815], // 球头最宽
    [0.186, 0.852],
    [0.172, 0.884],
    [0.148, 0.914],
    [0.116, 0.94],
    [0.076, 0.962],
    [0.036, 0.98],
    [0.0, 0.988],
  ];
  return pts.map(([x, y]) => new THREE.Vector2(x, y));
}

/**
 * 定制盒体 UV：+Y 面映射到贴图上半张（格面），其余面映射到下半张（格块侧壁）。
 * 格块是"摊在底板上的筹码"，白对白会糊成一片，全靠侧壁那圈灰把相邻格分开。
 */
function tileGeometry(size: number, height: number) {
  const g = new THREE.BoxGeometry(size, height, size);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  const topRect: [number, number, number, number] = [0.02, 0.52, 0.98, 0.98];
  const sideRect: [number, number, number, number] = [0.06, 0.14, 0.94, 0.4];
  // 6 个面 × 4 顶点，顺序 +X, -X, +Y, -Y, +Z, -Z
  const rects = [sideRect, sideRect, topRect, sideRect, sideRect, sideRect];
  const origin: [number, number][] = [
    [0, 1],
    [1, 1],
    [0, 0],
    [1, 0],
  ];
  for (let f = 0; f < 6; f++) {
    const r = rects[f];
    for (let j = 0; j < 4; j++) {
      const i = f * 4 + j;
      const [u0, v0, u1, v1] = r;
      uv.setXY(i, u0 + origin[j][0] * (u1 - u0), v0 + origin[j][1] * (v1 - v0));
    }
  }
  uv.needsUpdate = true;
  return g;
}

/* ------------------------------------------------------------------ *
 *  格子收集：把场景的「环道 + 登顶航道」摊平成一张格表
 * ------------------------------------------------------------------ */

export interface TileCell {
  /** 同格判定键，来自 scene.cellKey() */
  key: string;
  point: TrackPoint;
  kind: TileKind;
  /** false = 这一步没有实体格块（中央终点这类交给专门的构件表现） */
  solid: boolean;
}

/**
 * 环道格 + 每个起点的登顶航道格，按 key 去重。
 *
 * 这里刻意只走 SceneDef 的公开方法（cellKey / node / kind），不认识任何一张具体棋盘；
 * 换场景时这段代码一行都不用动。航道按「最多 4 条」铺满，所以两人局也能看到完整的四条航道。
 */
export function collectCells(def: SceneDef, arms = 4): TileCell[] {
  const out: TileCell[] = [];
  const seen = new Set<string>();
  const push = (key: string, point: TrackPoint, kind: TileKind, solid: boolean) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, point, kind, solid });
  };

  for (const t of def.ring) push(def.cellKey(0, t.index), t, t.kind, true);

  for (const start of def.starts(arms)) {
    for (let k = 1; k <= def.climb; k++) {
      const pos = def.ringLap + k;
      push(def.cellKey(start, pos), def.node(start, pos), def.kind(start, pos), k < def.climb);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  格块层：材质池 + 踩踏脉动 + 当前格高亮
 * ------------------------------------------------------------------ */

/**
 * 一套棋盘上所有「会发光、会被踩」的格块。
 * 各场景的棋盘视图把 collectCells() 的结果丢进来，剩下的材质池、踩踏弹跳、高亮环都走这里，
 * 于是「新棋盘长什么样」和「格块怎么动」这两件事就分开了。
 */
export class TileLayer {
  readonly group = new THREE.Group();

  private cells: TileCell[] = [];
  private indexOf = new Map<string, number>();
  private meshes: (THREE.Mesh | null)[] = [];
  /** 每个格块静止时的 y（脉动结束后要落回这里） */
  private restY: number[] = [];
  private mats = new Map<TileKind, THREE.MeshStandardMaterial>();
  private geo: THREE.BufferGeometry;
  private pulses = new Map<number, number>();
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private hlMat: THREE.MeshBasicMaterial;
  private hlRing!: THREE.Mesh;
  private hlFrame!: THREE.Mesh;
  private hl: THREE.Group;
  private t = 0;
  /** 额外的整体抬升：终点要垫在中央平台上的那种情况 */
  private lift: number;
  /** 格面处理：城市是"白底板上的筹码"，浮岛是"石板路上的镶嵌" */
  private surface: TileSurface;

  constructor(size: number, lift = 0, surface: TileSurface = "chip") {
    this.lift = lift;
    this.surface = surface;
    this.group.name = "tiles";
    // 格块实宽收一点（0.99）：相邻格之间留一道缝，48 块才数得出来
    this.geo = tileGeometry(size * 0.99, SCALE.tileH);
    this.disposables.push(this.geo);

    this.hlMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.disposables.push(this.hlMat);

    this.hl = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(size * 0.52, size * 0.78, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.hlRing = new THREE.Mesh(ringGeo, this.hlMat);
    const frameGeo = new THREE.RingGeometry(size * 0.9, size * 1.05, 4);
    frameGeo.rotateX(-Math.PI / 2);
    frameGeo.rotateY(Math.PI / 4);
    this.hlFrame = new THREE.Mesh(frameGeo, this.hlMat);
    this.hl.add(this.hlRing, this.hlFrame);
    this.hl.visible = false;
    this.disposables.push(ringGeo, frameGeo);
    this.group.add(this.hl);
  }

  /** 静止时格块中心的 y */
  private get baseY() {
    return SCALE.boardTop + SCALE.tileH / 2 + this.lift;
  }

  private materialFor(kind: TileKind) {
    let mat = this.mats.get(kind);
    if (mat) return mat;
    const tex = createTileTexture(kind, this.surface);
    // 自发光走 emissiveMap 而不是平涂颜色：格块是"背光的贴纸"，
    // 用自身贴图发光能整块提亮却保留 icon 与色块的内部对比（平涂会把 icon 洗掉）。
    mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: kind === "plain" ? 0.86 : 0.72,
      metalness: 0.04,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: tex,
      emissiveIntensity: 0,
      envMapIntensity: this.surface === "stone" ? 0.4 : 0.55,
      toneMapped: true,
    });
    this.mats.set(kind, mat);
    this.disposables.push(mat, tex);
    return mat;
  }

  add(cells: TileCell[]) {
    for (const cell of cells) {
      const i = this.cells.length;
      this.cells.push(cell);
      this.indexOf.set(cell.key, i);
      this.restY.push(this.baseY);

      if (!cell.solid) {
        this.meshes.push(null);
        continue;
      }
      const mesh = new THREE.Mesh(this.geo, this.materialFor(cell.kind));
      mesh.position.set(cell.point.x, this.baseY, cell.point.z);
      mesh.rotation.y = Math.atan2(-cell.point.tz, cell.point.tx);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  /** 该格被踩到时的高亮与弹跳 */
  pulse(key: string, strength = 1) {
    const i = this.indexOf.get(key);
    if (i == null || !this.meshes[i]) return;
    this.pulses.set(i, Math.min(1.6, strength));
  }

  /** 当前行动格：高亮环挪过去（这一步没有实体格块也照样给个落点） */
  focus(key: string | null) {
    const i = key === null ? undefined : this.indexOf.get(key);
    if (i == null) {
      this.hl.visible = false;
      return;
    }
    const c = this.cells[i];
    this.hl.visible = true;
    this.hl.position.set(c.point.x, SCALE.tileTop + 0.06 + this.lift, c.point.z);
  }

  setHighlightColor(hex: string) {
    this.hlMat.color.set(hex);
  }

  setTime(time: "day" | "night") {
    // 白昼也留一点自发光：强阳光会把色块往白里推，这一档"背光"是让格子的颜色
    // 在白铺装上仍然读得出来的补偿，夜里则当灯箱用。
    // 石板格面要弱一档 —— 石头本身不该像灯箱那样发光，夜里的亮度交给路灯与萤火虫。
    const emit = this.surface === "stone"
      ? (time === "night" ? 0.2 : 0.1)
      : (time === "night" ? 0.32 : 0.22);
    for (const [, mat] of this.mats) mat.emissiveIntensity = emit;
  }

  update(dt: number) {
    this.t += dt;
    // 格子被踩：抬升 + 松开
    for (const [i, v] of this.pulses) {
      const mesh = this.meshes[i];
      const decay = v - dt * 2.2;
      if (decay <= 0 || !mesh) {
        this.pulses.delete(i);
        if (mesh) {
          mesh.scale.set(1, 1, 1);
          mesh.position.y = this.restY[i];
        }
        continue;
      }
      this.pulses.set(i, decay);
      const k = Math.sin(decay * Math.PI) * 0.5;
      mesh.position.y = this.restY[i] + k * 0.24;
      mesh.scale.set(1 + k * 0.07, 1, 1 + k * 0.07);
    }

    if (this.hl.visible) {
      const s = 1 + Math.sin(this.t * 3.1) * 0.07;
      this.hlRing.scale.setScalar(s);
      this.hlRing.rotation.y = this.t * 0.6;
      this.hlFrame.rotation.y = Math.PI / 4 - this.t * 0.35;
      this.hlMat.opacity = 0.55 + Math.sin(this.t * 3.1) * 0.22;
    }
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
