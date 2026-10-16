/**
 * 场景 A《云顶都会》—— 圆角方环。
 *
 * 48 格等分环道，索引 0 落在 +Z 边中点（屏幕左下）的 START 拱门，
 * 索引 24 恰好是 −Z 边中点（屏幕右上），即半程纪念碑所在格。
 * 四位玩家共用同一个起点，绕环一圈冲线即胜 —— 这里 climb = 0。
 */

import type { TileKind } from "../theme";
import { type SceneDef, type TileDef, type TrackPoint, wrapIndex } from "./types";

/** 圆角方环几何 */
export const CITY_RING = {
  half: 14,
  corner: 5.5,
  tiles: 48,
  tileSize: 1.9,
  tileGap: 0.2366,
  /** 半程纪念碑格（屏幕右上角） */
  halfway: 24,
} as const;

const RING_PERIMETER = 4 * 2 * (CITY_RING.half - CITY_RING.corner) + 2 * Math.PI * CITY_RING.corner;

const TILE_SPACING = RING_PERIMETER / CITY_RING.tiles;

const S = CITY_RING.half - CITY_RING.corner; // 直段半长
const C = CITY_RING.corner;
const ARC = (Math.PI * C) / 2;

type Seg =
  | { kind: "line"; from: [number, number]; dir: [number, number]; len: number }
  | { kind: "arc"; cx: number; cz: number; a0: number; a1: number; len: number };

/**
 * 参数化路径：从 (0, +half) 出发，先沿 +X 走到圆角，再依次绕行。
 */
function buildSegments(): Seg[] {
  const segs: Seg[] = [];
  segs.push({ kind: "line", from: [0, CITY_RING.half], dir: [1, 0], len: S });
  segs.push({ kind: "arc", cx: S, cz: S, a0: Math.PI / 2, a1: 0, len: ARC });
  segs.push({ kind: "line", from: [CITY_RING.half, S], dir: [0, -1], len: 2 * S });
  segs.push({ kind: "arc", cx: S, cz: -S, a0: 0, a1: -Math.PI / 2, len: ARC });
  segs.push({ kind: "line", from: [S, -CITY_RING.half], dir: [-1, 0], len: 2 * S });
  segs.push({ kind: "arc", cx: -S, cz: -S, a0: -Math.PI / 2, a1: -Math.PI, len: ARC });
  segs.push({ kind: "line", from: [-CITY_RING.half, -S], dir: [0, 1], len: 2 * S });
  segs.push({ kind: "arc", cx: -S, cz: S, a0: Math.PI, a1: Math.PI / 2, len: ARC });
  segs.push({ kind: "line", from: [-S, CITY_RING.half], dir: [1, 0], len: S });
  return segs;
}

const SEGMENTS = buildSegments();

/** 按弧长 s 采样环道中心线（含切线与内侧法线） */
function sampleRing(s: number): TrackPoint {
  let t = s % RING_PERIMETER;
  if (t < 0) t += RING_PERIMETER;
  for (const seg of SEGMENTS) {
    if (t > seg.len) {
      t -= seg.len;
      continue;
    }
    if (seg.kind === "line") {
      const x = seg.from[0] + seg.dir[0] * t;
      const z = seg.from[1] + seg.dir[1] * t;
      // 法线 = 切线绕 Y 轴逆时针 90°
      return { x, z, tx: seg.dir[0], tz: seg.dir[1], nx: seg.dir[1], nz: -seg.dir[0] };
    }
    const k = t / seg.len;
    const a = seg.a0 + (seg.a1 - seg.a0) * k;
    const px = seg.cx + C * Math.cos(a);
    const pz = seg.cz + C * Math.sin(a);
    // 弧线沿角度减小方向行进
    const sign = seg.a1 < seg.a0 ? -1 : 1;
    const tx = -Math.sin(a) * sign;
    const tz = Math.cos(a) * sign;
    return { x: px, z: pz, tx, tz, nx: tz, nz: -tx };
  }
  const last = SEGMENTS[SEGMENTS.length - 1];
  if (last.kind === "line") {
    return {
      x: last.from[0] + last.dir[0] * last.len,
      z: last.from[1] + last.dir[1] * last.len,
      tx: last.dir[0], tz: last.dir[1], nx: last.dir[1], nz: -last.dir[0],
    };
  }
  return { x: 0, z: CITY_RING.half, tx: 1, tz: 0, nx: 0, nz: 1 };
}

/**
 * 48 格的事件编排（索引 0 为 START）。节奏原则：
 * 前段密集给正反馈建立手感，中段掺入负面制造波折，末段（临近起点）难度回落，
 * 相邻格尽量避免连续负面。
 */
const TILE_PLAN: TileKind[] = [
  "start",   // 0
  "plain",   // 1
  "forward", // 2
  "gift",    // 3
  "plain",   // 4
  "quiz",    // 5
  "barrier", // 6
  "plain",   // 7
  "boost",   // 8
  "swap",    // 9
  "dash",    // 10
  "quiz",    // 11
  "plain",   // 12
  "forward", // 13
  "barrier", // 14
  "plain",   // 15
  "gift",    // 16
  "forward", // 17
  "plain",   // 18
  "ice",     // 19
  "quiz",    // 20
  "plain",   // 21
  "boost",   // 22
  "shield",  // 23
  "plain",   // 24  ← 半程
  "forward", // 25
  "gift",    // 26
  "plain",   // 27
  "barrier", // 28
  "quiz",    // 29
  "boost",   // 30
  "plain",   // 31
  "ice",     // 32
  "swap",    // 33
  "dash",    // 34
  "forward", // 35
  "quiz",    // 36
  "plain",   // 37
  "gift",    // 38
  "barrier", // 39
  "boost",   // 40
  "plain",   // 41
  "shield",  // 42
  "forward", // 43
  "quiz",    // 44
  "plain",   // 45
  "portal",  // 46
  "boost",   // 47
];

function buildRing(): TileDef[] {
  const tiles: TileDef[] = [];
  for (let i = 0; i < CITY_RING.tiles; i++) {
    const s = i * TILE_SPACING;
    tiles.push({ ...sampleRing(s), index: i, kind: TILE_PLAN[i] ?? "plain", s });
  }
  return tiles;
}

const RING_TILES = buildRing();

/**
 * 底板外缘半宽 = 环道半径 + 半个格 + 包边；
 * 内缘半宽 = 环道半径 − 半个格 − 台沿，也就是中央园区能铺到的半宽。
 */
const PLATE = {
  outer: CITY_RING.half + CITY_RING.tileSize / 2 + 1.9,
  inner: CITY_RING.half - CITY_RING.tileSize / 2 - 0.55,
  height: 0.2,
} as const;

/** 共用起点：所有座位的起点都是环道索引 0 */
function starts(seats: number): number[] {
  return Array.from({ length: Math.max(1, seats) }, () => 0);
}

export const cityScene: SceneDef = {
  id: "city",
  label: "云顶都会",
  sub: "共用起点 · 环线一圈冲线",
  tagline: "一座会发光的微缩都会，48 格环城竞速。",

  tiles: CITY_RING.tiles,
  ringLap: CITY_RING.tiles,
  climb: 0,
  lap: CITY_RING.tiles,

  tileSize: CITY_RING.tileSize,
  tileGap: CITY_RING.tileGap,

  ring: RING_TILES,
  plate: PLATE,
  view: { baseFrustum: 50, minFrustum: 37 },
  finish: { x: 0, z: -6 },
  halfway: CITY_RING.halfway,

  rules: [
    "围着一整圈环道跑 48 格，绕过起点拱门即冲线。",
    "轮到你时点右下角掷骰子，棋子会逐格跳过去。",
    "落点决定命运：加速、空投、事件、施工、冻结、换乘。",
    "屏幕右上角的红旗台是半程纪念碑，路过即过半程。",
    "拖拽旋转视角、滚轮缩放，随时切换昼夜。",
  ],

  winWord: "冲线",
  winTitle: "冲线夺冠",
  winLog: (name, rank) => `${name} 绕过起点拱门，锁定第 ${rank} 名。`,

  starts,

  node(_start: number, pos: number): TrackPoint {
    return RING_TILES[wrapIndex(pos, CITY_RING.tiles)];
  },

  kind(_start: number, pos: number): TileKind {
    return RING_TILES[wrapIndex(pos, CITY_RING.tiles)].kind;
  },

  cellKey(_start: number, pos: number): string {
    return `r${wrapIndex(pos, CITY_RING.tiles)}`;
  },

  isWin(pos: number): boolean {
    return pos >= CITY_RING.tiles;
  },

  moveTarget(pos: number, steps: number): number {
    return Math.min(CITY_RING.tiles, pos + steps);
  },
};
