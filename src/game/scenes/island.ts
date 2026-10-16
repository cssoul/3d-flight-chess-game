/**
 * 场景 B《云顶浮岛》—— 一座漂在碧水上的花园孤岛，四方起点 + 中央石台 🏁。
 *
 * 规则几何和 A 场景完全不同，但仍然是「一条环道 + 每人一份里程」：
 * 棋盘是一条「十」字形的石板环道，四位玩家从四条臂的端头各自出发，**沿同一个方向**
 * 绕行一整圈回到自己的起点木门，然后转入自己那条臂的登顶道，一路登上中央石台 ——
 * 先登顶者取胜。
 *
 * 几何上的两个巧合都是刻意留的：
 * 1. 十字周长 = 8·reach，48 格等分后每条臂端中点正好落在 0 / 12 / 24 / 36，
 *    四个起点天然四等分，谁都不吃亏；
 * 2. 登顶道的格距（1.9）比环道格距（2.33）只紧一点点，棋子从臂端拐进登顶道时
 *    步子不会忽大忽小，同时 5 块实体格正好落在半径 12.1 → 4.5 之间，
 *    最里面那块的内沿不会压到中央石台。
 *
 * 里程完全是「玩家自己的」：pos=0 是自己的起点、pos=48 是回到自己的起点、
 * pos=49..53 是登顶道、pos=54 是中央石台。因此四方起点不需要任何特例分支，
 * 只需要在 node() 里把 pos 平移到自己那条臂上。
 */

import type { TileKind } from "../theme";
import { type SceneDef, type TileDef, type TrackPoint, wrapIndex } from "./types";

export const ISLAND = {
  /** 臂端到中心的距离 */
  reach: 14,
  /** 臂的半宽 */
  half: 4.5,
  tiles: 48,
  tileSize: 1.9,
  tileGap: 0.45,
  /** 登顶道步数（含最里侧的中央石台） */
  climb: 6,
  /** 四条臂的朝向，下标 = 臂号 */
  arms: [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
  ] as [number, number][],
} as const;

const { reach, half: W, tiles } = ISLAND;

/** 十字周长 = 8·reach；十字不需要圆角，拐点全是直角 */
const PERIMETER = 8 * reach;
const SPACING = PERIMETER / tiles;

/**
 * 登顶道的格距。比环道格距（2.3333）紧一档：
 * 5 块实体格正好落在半径 12.25 → 5.25 之间，最里面那块的内沿（5.25 − 0.95 = 4.3）
 * 才不会压到中央石台（底盘半径 4.2）。第 6 步（= lap）直接落在台顶圆心，等于最后"一跃登顶"。
 */
export const CLIMB_STEP = 1.75;

type Seg = { from: [number, number]; dir: [number, number]; len: number };

/**
 * 十字轮廓的 13 段折线。起点取在**上臂端中点** (0, +reach) 且朝 +X 前进，
 * 于是索引 0 = 北臂起点，索引 12 / 24 / 36 = 东 / 南 / 西臂起点。
 * 四段臂端横边各长 2W，八段"肩"边各长 reach − W，合计 8W + 8(reach − W) = 8·reach。
 */
const SEGMENTS: Seg[] = [
  { from: [0, reach], dir: [1, 0], len: W },
  { from: [W, reach], dir: [0, -1], len: reach - W },
  { from: [W, W], dir: [1, 0], len: reach - W },
  { from: [reach, W], dir: [0, -1], len: 2 * W },
  { from: [reach, -W], dir: [-1, 0], len: reach - W },
  { from: [W, -W], dir: [0, -1], len: reach - W },
  { from: [W, -reach], dir: [-1, 0], len: 2 * W },
  { from: [-W, -reach], dir: [0, 1], len: reach - W },
  { from: [-W, -W], dir: [-1, 0], len: reach - W },
  { from: [-reach, -W], dir: [0, 1], len: 2 * W },
  { from: [-reach, W], dir: [1, 0], len: reach - W },
  { from: [-W, W], dir: [0, 1], len: reach - W },
  { from: [-W, reach], dir: [1, 0], len: W },
];

/** 按弧长采样十字环道（含切线与内侧法线） */
function sampleRing(s: number): TrackPoint {
  let t = s % PERIMETER;
  if (t < 0) t += PERIMETER;
  for (const seg of SEGMENTS) {
    if (t > seg.len) {
      t -= seg.len;
      continue;
    }
    const x = seg.from[0] + seg.dir[0] * t;
    const z = seg.from[1] + seg.dir[1] * t;
    // 内侧法线 = 切线顺时针 90°，与城市场景同一约定
    return { x, z, tx: seg.dir[0], tz: seg.dir[1], nx: seg.dir[1], nz: -seg.dir[0] };
  }
  const last = SEGMENTS[SEGMENTS.length - 1];
  return {
    x: last.from[0] + last.dir[0] * last.len,
    z: last.from[1] + last.dir[1] * last.len,
    tx: last.dir[0], tz: last.dir[1], nx: last.dir[1], nz: -last.dir[0],
  };
}

/**
 * 12 格一段的循环编排，四条臂完全同构 —— 这样不论谁从哪条臂出发，
 * 面对的格序都一样，比赛是公平的；盘面上四条臂长得一样也是刻意的（对称的园林感）。
 * 索引 0 一定是 start，索引 11 一定是正面格，让每条臂的收尾都舒服。
 */
const MOTIF: TileKind[] = [
  "start",   // 0
  "plain",   // 1
  "boost",   // 2  ← 起跑后立刻给一次加速
  "gift",    // 3
  "plain",   // 4
  "quiz",    // 5
  "plain",   // 6
  "forward", // 7
  "barrier", // 8  ← 唯一的负面，前后都是缓冲
  "plain",   // 9
  "dash",    // 10 ← 直道冲刺
  "shield",  // 11
];

function buildRing(): TileDef[] {
  const out: TileDef[] = [];
  for (let i = 0; i < tiles; i++) {
    const s = i * SPACING;
    out.push({ ...sampleRing(s), index: i, kind: MOTIF[i % MOTIF.length], s });
  }
  return out;
}

const RING_TILES = buildRing();

/** 胜利里程 = 环道一圈 + 登顶道 */
const LAP = tiles + ISLAND.climb;

/** 起点索引 → 臂号 */
export function armOf(start: number): number {
  return wrapIndex(Math.round(start / (tiles / ISLAND.arms.length)), ISLAND.arms.length);
}

/** 起点索引 → 该臂由内向外（远离中心）的方向 */
export function armDir(start: number): { x: number; z: number } {
  const a = ISLAND.arms[armOf(start)];
  return { x: a[0], z: a[1] };
}

/**
 * 座位 → 起点。
 * 两人局给对角的臂（0 / 2），三人局给 0 / 1 / 2，四人局四条臂全上，
 * 免得两人对战时挤在相邻两条臂上互相看背影。
 */
function starts(seats: number): number[] {
  const n = ISLAND.arms.length;
  const order = [0, 2, 1, 3]; // 先对角、再补齐
  const list: number[] = [];
  for (let i = 0; i < Math.max(1, Math.min(seats, n)); i++) list.push(order[i] * (tiles / n));
  return list;
}

/** 登顶道：从臂端中点朝中心走，第 climb 步正好落在台顶圆心 */
function climbPoint(start: number, k: number): TrackPoint {
  const d = armDir(start);
  // k = 1..climb；1..climb-1 是石板格，第 climb 步到达中心（半径 0）
  const r = k >= ISLAND.climb ? 0 : reach - k * CLIMB_STEP;
  const tx = -d.x;
  const tz = -d.z;
  return { x: d.x * r, z: d.z * r, tx, tz, nx: tz, nz: -tx };
}

/** 中央石台格：四条登顶道的公共终点 */
const CENTRE: TrackPoint = { x: 0, z: 0, tx: 0, tz: -1, nx: -1, nz: 0 };

/**
 * 岛的轮廓半径（名义值）。真正的岸线在 `three/coast.ts` 里 —— 那是一条带起伏的
 * 不规则曲线，沙岸半径在 18.5~24.3 之间摆动；这里给的只是它的平均值，
 * 渲染层拿它当尺度基准（取景、睡莲带、远景小岛的排布）。
 *
 * 唯一的硬约束是草地半径（约 19.6 × 0.902 ≈ 17.7）必须一直包得住十字环道
 * 石板带最远的那个角（≈16.3），否则某个朝向上会露出土坎。
 */
const LAND_R = 21.4;

const PLATE = {
  outer: LAND_R,
  /** 十字臂的净半宽，渲染层拿它铺"环道内侧的空地" */
  inner: W,
  height: 0.2,
} as const;

export const islandScene: SceneDef = {
  id: "island",
  label: "云顶浮岛",
  sub: "四方起点 · 绕岛一圈后登顶中央石台",
  tagline: "一座漂在碧水上的花园孤岛，绕行一周后登上中央石台。",

  tiles,
  ringLap: tiles,
  climb: ISLAND.climb,
  lap: LAP,

  tileSize: ISLAND.tileSize,
  tileGap: ISLAND.tileGap,

  ring: RING_TILES,
  plate: PLATE,
  // 岛比城市场景的底板大一圈（草坡 + 沙滩约到 21.3）。取景按"横向一定放得下、
  // 竖向上尽量占满"来定：baseFrustum 56 保证窄屏按宽度兜住整座岛，
  // minFrustum 33 让宽屏上岛占到画面宽度的四分之三左右。
  view: { baseFrustum: 56, minFrustum: 33 },
  finish: { x: 0, z: 0 },

  rules: [
    "四位玩家从岛上四个方向的起点出发，沿石板环道同向绕行。",
    "跑满一圈 48 格回到自己的起点木门，随即转入自己的登顶道。",
    "沿登顶道再走 6 格登上中央石台，先登顶者取胜。",
    "四条臂的格序完全一致，站哪一边都不吃亏。",
    "拖拽旋转视角、滚轮缩放，随时切换昼夜。",
  ],

  winWord: "登顶",
  winTitle: "登顶夺冠",
  winLog: (name, rank) => `${name} 绕岛一周又拾级而上登上中央石台，锁定第 ${rank} 名。`,

  starts,

  node(start: number, pos: number): TrackPoint {
    if (pos <= tiles) return RING_TILES[wrapIndex(start + pos, tiles)];
    if (pos >= LAP) return CENTRE;
    return climbPoint(start, pos - tiles);
  },

  kind(start: number, pos: number): TileKind {
    // pos = tiles 正好踩回自己的起点木门，之后才转进登顶道
    if (pos <= tiles) return RING_TILES[wrapIndex(start + pos, tiles)].kind;
    return "home";
  },

  cellKey(start: number, pos: number): string {
    if (pos <= tiles) return `r${wrapIndex(start + pos, tiles)}`;
    if (pos >= LAP) return "fin";
    // 登顶道是各臂自己的，键里必须带臂号，否则两条臂的同一步会被当成同一格
    return `h${armOf(start)}:${pos - tiles}`;
  },

  isWin(pos: number): boolean {
    return pos >= LAP;
  },

  moveTarget(pos: number, steps: number): number {
    return Math.min(LAP, pos + steps);
  },
};
