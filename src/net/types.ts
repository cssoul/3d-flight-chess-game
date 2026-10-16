import type { LogEntry, PlayerSetup, PlayerState, TileResolution, Tone } from "../game/types";

/** 房间里的一个座位（服务端 seats 数组的一项）。token 只在本地持有者手里有意义。 */
export interface SeatInfo {
  seat: string;
  token: string;
  name: string;
  charId: string;
  kind: "human" | "ai";
  /** 服务端 epoch 秒，用于判断掉线 */
  seen: number;
}

export type MoveMode = "hop" | "boost" | "retreat";

/**
 * 一次动作里的一个「演出拍子」。
 *
 * 之所以要把表演拆成可序列化的拍子：这一局里所有随机数（骰子点数、空投礼物、
 * 事件分支、互换对象）都在房主那台机器上被抽掉了，别的客户端只负责把同一套
 * 动画再演一遍 —— 它们不重算规则，因此不可能算出不一样的结果。
 */
export type Step =
  | { t: "active"; who: number }
  | { t: "wait"; s: number }
  | { t: "hint"; text: string }
  | { t: "rollable"; v: boolean }
  | { t: "dice"; who: number; value: number }
  | { t: "move"; who: number; from: number; to: number; mode: MoveMode }
  | { t: "swap"; a: number; b: number }
  | { t: "land"; who: number; pos: number; fx: string }
  | { t: "effect"; who: number; res: TileResolution }
  | { t: "toast"; who: number; title: string; desc: string; tone: Tone; icon: string }
  | { t: "frozen"; who: number; on: boolean }
  | { t: "shield"; who: number; on: boolean }
  | { t: "finished"; who: number }
  | { t: "celebrate"; who: number }
  | { t: "teleport"; who: number; pos: number };

/** 一个完整回合的剧本：房主录制、全员回放。 */
export interface TurnRecord {
  /** 第几个回合，从 1 开始，用于去重 */
  n: number;
  /** 本回合行动的玩家 id */
  holder: number;
  dice: number;
  steps: Step[];
  before: PlayerState[];
  after: PlayerState[];
  feed: LogEntry[];
  round: number;
  /** 下一位行动者 */
  turn: number;
  /** -1 表示还没结束 */
  winner: number;
  phase: "playing" | "over";
  at: number;
}

/** 房间文档里 game 字段的内容。前五项由房主独占写入。 */
export interface GameDoc {
  setups: PlayerSetup[];
  /**
   * 这一局用的是哪张棋盘（SceneId）。必须由房主写进房间：
   * 棋盘决定格子在世界的坐标，看客要是自己选一张，棋子的每一步都会落在别的地方。
   */
  scene?: string;
  turn: number;
  round: number;
  /** 已广播的回合数 */
  plays: number;
  phase: "playing" | "over";
  players: PlayerState[];
  winner: number;
  /** 最近若干个回合的剧本；掉线回来的人靠它补齐 */
  hist: TurnRecord[];
}

export interface CmdEntry {
  n: number;
  seat: string;
  kind: string;
  data: { turn?: number } | null;
  at: number;
}

export interface RoomRow {
  code: string;
  rev: number;
  status: "lobby" | "playing" | "over";
  host_seat: string;
  seats: SeatInfo[];
  game: Partial<GameDoc>;
  feed: LogEntry[];
  cmds: CmdEntry[];
  beat_at: string;
  created_at: string;
  updated_at: string;
}

/** 服务端 room_* 系列函数的统一返回。 */
export interface RpcResult {
  ok: boolean;
  reason?: "not_found" | "forbidden" | "started" | "full" | "conflict" | "busy";
  rev?: number;
  room?: RoomRow;
  seatIndex?: number;
  changed?: boolean;
  serverNow?: number;
}

export function reasonText(reason: RpcResult["reason"]): string {
  switch (reason) {
    case "not_found":
      return "房间不存在或已解散，检查一下房间号。";
    case "forbidden":
      return "身份已失效（可能换过设备或清了缓存），请重新加入房间。";
    case "started":
      return "这一局已经开始，暂时不接受新玩家。";
    case "full":
      return "房间已满（最多 4 位）。";
    case "busy":
      return "房间号刚好撞车了，再试一次。";
    case "conflict":
      return "状态已被其他人更新，正在同步。";
    default:
      return "网络请求失败，稍后会自动重试。";
  }
}
