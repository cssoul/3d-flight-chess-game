/**
 * 场景契约层 —— 一个场景 = 一张棋盘 + 一套走法。
 *
 * 规则内核（engine）、导演（director）、渲染（SceneManager / boards）都不认识具体棋盘，
 * 只认这份接口。每个场景自己住在 scenes/<id>.ts 里，互不 import，改一个不会碰到另一个。
 *
 * 约定：
 * - `pos` 是**玩家自己的里程**，从 0（自己的起点）走到 lap（终点），与座位无关；
 *   同一个 pos 落在世界里的哪一格，由场景的 node()/kind() 决定。
 * - 法线 n 统一取**指向棋盘内侧**的那一侧（与坐标无关，纯粹是绕行方向的右/左手性），
 *   渲染层用它来摆长椅、纪念碑、基地这类"靠内/靠外"的装饰。
 */

import type { TileKind } from "../theme";

/** 环道上的一个采样点 */
export interface TrackPoint {
  x: number;
  z: number;
  /** 前进方向的切线（单位向量） */
  tx: number;
  tz: number;
  /** 内侧法线（单位向量） */
  nx: number;
  nz: number;
}

export interface TileDef extends TrackPoint {
  /** 几何索引 0..tiles-1，不是玩家里程 */
  index: number;
  kind: TileKind;
  /** 沿环道的弧长 */
  s: number;
}

export type SceneId = "city" | "island";

export interface SceneDef {
  id: SceneId;
  /** 卡片标题 */
  label: string;
  /** 规则一句话 */
  sub: string;
  tagline: string;

  /** 环道格数 */
  tiles: number;
  /** 绕环道一圈的步数（= tiles） */
  ringLap: number;
  /** 冲线后的「登顶段」步数；0 表示冲过自己的起点即胜 */
  climb: number;
  /** 胜利里程：pos >= lap 即获胜 */
  lap: number;

  tileSize: number;
  tileGap: number;

  /** 环道格（长度 = tiles） */
  ring: TileDef[];

  /** 底板 */
  plate: { outer: number; inner: number; height: number };

  /** 取景尺度：正交相机视高 = max(minFrustum, baseFrustum/aspect) / zoom */
  view: { baseFrustum: number; minFrustum: number };

  /** 冲线后庆祝动画的落位点 */
  finish: { x: number; z: number };

  /** 半程纪念碑所在的环道索引；没有就留空 */
  halfway?: number;

  /** 大厅「怎么玩」里的规则条目 —— 每张棋盘的玩法归每张棋盘自己讲 */
  rules: string[];

  /** 最后一步的说法：城市盘叫「冲线」，登顶盘叫「登顶」 */
  winWord: string;
  /** 结算弹窗标题，例如「冲线夺冠」「登顶夺冠」 */
  winTitle: string;
  /** 冲线播报：不同场景的胜利形态不同，措辞也归场景自己写 */
  winLog(name: string, rank: number): string;

  /**
   * 座位数 → 每个座位起点的环道索引（长度 = 座位数）。
   *
   * 下面三个方法收的是「起点索引 start」而不是座位号：场景本身没有状态，
   * 不应该偷偷记住上一次传进来的座位表；调用方（引擎 / 渲染）自己持一份 starts 即可。
   */
  starts(seats: number): number[];

  /** 起点在 start 格的玩家，走到 pos 步时的世界节点 */
  node(start: number, pos: number): TrackPoint;

  /** 起点在 start 格的玩家，走到 pos 步时踩到的格型 */
  kind(start: number, pos: number): TileKind;

  /**
   * 同一格的分槽键。落到同一键上的棋子共享一格，需要错开摆放。
   * 里程 pos 不能直接当键用 —— 四方起点场景里，两个玩家同在 pos=3 其实在不同臂上。
   */
  cellKey(start: number, pos: number): string;

  isWin(pos: number): boolean;
  moveTarget(pos: number, steps: number): number;
}

export function wrapIndex(i: number, n: number): number {
  return ((i % n) + n) % n;
}

/** 一步走完的路径：[from+1, ..., to] */
export function stepPath(from: number, to: number): number[] {
  const out: number[] = [];
  for (let p = from + 1; p <= to; p++) out.push(p);
  return out;
}
