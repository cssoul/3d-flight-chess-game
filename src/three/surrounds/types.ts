import type * as THREE from "three";
import type { TimeOfDay } from "../env";

/**
 * 棋盘之外那一层的契约。
 *
 * 城市场景外面是一座微缩都会，浮岛场景外面是一片碧海 —— 两者对场景总控来说
 * 都只是「一个能换时辰、能逐帧更新、能被销毁的 Group」。抽这一层的理由和 BoardView 一样：
 * 换棋盘时外面那圈世界也得跟着换，而 SceneManager 不该知道外面到底是楼还是水。
 *
 * 城市那座 City 天生就满足这个接口（group / setTime / update / dispose），所以
 * citySurround 不需要包装类，直接用 City 本身。
 */
export interface SurroundView {
  group: THREE.Group;
  setTime(time: TimeOfDay): void;
  update(dt: number): void;
  dispose(): void;
}
