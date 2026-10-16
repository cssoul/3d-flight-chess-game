import type * as THREE from "three";

/**
 * 棋盘视图契约。
 *
 * 场景总控（SceneManager）只认这几个方法，不认识「城市棋盘」还是「登顶棋盘」；
 * 每个场景的棋盘视图自己住在 boards/<id>Board.ts 里，改一个不会碰另一个。
 *
 * 坐标一律用「起点索引 start + 里程 pos」表达，视图内部再翻译成世界坐标 ——
 * 这样四方起点这类「同一 pos 对应不同格」的规则不需要渲染层知道。
 */
export interface BoardView {
  group: THREE.Group;

  /** 开局时把属于玩家色的构件涂成各自的颜色；不需要这层的棋盘留空实现 */
  setSeatColors(colors: string[]): void;

  /** 某一步被踩到的弹跳 */
  pulse(start: number, pos: number, strength?: number): void;

  /** 当前行动格的高亮环；pos 传 null 表示收起 */
  focusAt(start: number, pos: number | null): void;

  setHighlightColor(hex: string): void;

  setTime(time: "day" | "night"): void;

  update(dt: number): void;

  dispose(): void;
}
