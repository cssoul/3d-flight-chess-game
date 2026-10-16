import type { TileKind } from "./theme";

export type GamePhase = "lobby" | "playing" | "result";

export interface PlayerSetup {
  id: number;
  name: string;
  charId: string;
  isAI: boolean;
}

export interface PlayerState {
  id: number;
  name: string;
  charId: string;
  color: string;
  deep: string;
  isAI: boolean;
  /** 0 .. scene.lap；等于 lap 表示已冲线（登顶棋盘里 lap 含最后的登顶段） */
  pos: number;
  freeze: number;
  shield: number;
  finished: boolean;
  rank: number | null;
  rollCount: number;
  lastRoll: number;
}

export type Tone = "good" | "bad" | "neutral";

export interface LogEntry {
  id: number;
  player: number;
  title: string;
  desc: string;
  tone: Tone;
  icon: string;
}

export interface Effect {
  t: "none" | "advance" | "retreat" | "skip" | "swap" | "shield" | "again" | "blocked";
  n?: number;
  title: string;
  desc: string;
  tone: Tone;
}

export interface TileResolution {
  kind: TileKind;
  effect: Effect;
  /** 结算后要接着走到的绝对位置 */
  moveTo: number | null;
  /** 换位目标玩家 id */
  swapWith?: number;
  /** 是否允许继续链式结算落点 */
  chain: boolean;
  /** 走完立即冲线 */
  win: boolean;
}

export interface DirectorHooks {
  onTurnStart: (player: PlayerState) => void;
  onDiceRoll: (player: PlayerState, value: number) => void;
  onMoveStart: (player: PlayerState, from: number, to: number) => void;
  onTileResolved: (player: PlayerState, res: TileResolution) => void;
  onSwap: (a: PlayerState, b: PlayerState) => void;
  onFinish: (winner: PlayerState, standings: PlayerState[]) => void;
}
