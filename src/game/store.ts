import { reactive } from "vue";
import type { GamePhase, LogEntry, PlayerState, Tone } from "./types";
import type { TimeOfDay } from "../three/env";

export interface Toast {
  id: number;
  player: number;
  title: string;
  desc: string;
  tone: Tone;
  icon: string;
}

/** HUD 上展示的座位（不含 token） */
export interface NetSeat {
  seat: string;
  name: string;
  charId: string;
  isMe: boolean;
  isHost: boolean;
  online: boolean;
}

export type NetStatus = "lobby" | "playing" | "over";

export interface NetState {
  active: boolean;
  code: string;
  seatIndex: number;
  isHost: boolean;
  /** 轮询链路是否通畅 */
  online: boolean;
  status: NetStatus;
  seats: NetSeat[];
  /** 正在进行的网络动作，用于把按钮置灰 */
  busy: "" | "create" | "join";
  error: string;
  /** 掉线被 AI 接管的座位号（-1 表示没有） */
  aiTakeover: number[];
}

export const emptyNet = (): NetState => ({
  active: false,
  code: "",
  seatIndex: -1,
  isHost: false,
  online: false,
  status: "lobby",
  seats: [],
  busy: "",
  error: "",
  aiTakeover: [],
});

export interface Store {
  phase: GamePhase;
  timeOfDay: TimeOfDay;
  speed: number;
  sound: boolean;
  players: PlayerState[];
  current: number;
  round: number;
  log: LogEntry[];
  toast: Toast | null;
  diceValue: number;
  rolling: boolean;
  canRoll: boolean;
  winner: PlayerState | null;
  standings: PlayerState[];
  stats: { fps: number; drawCalls: number; triangles: number; pixelRatio: number };
  sceneReady: boolean;
  hint: string;
  net: NetState;
}

export const store = reactive<Store>({
  phase: "lobby",
  timeOfDay: "day",
  speed: 1,
  sound: true,
  players: [],
  current: 0,
  round: 1,
  log: [],
  toast: null,
  diceValue: 0,
  rolling: false,
  canRoll: false,
  winner: null,
  standings: [],
  stats: { fps: 60, drawCalls: 0, triangles: 0, pixelRatio: 1 },
  sceneReady: false,
  hint: "",
  net: emptyNet(),
});

let toastId = 1;
export function showToast(player: number, title: string, desc: string, tone: Tone, icon: string) {
  store.toast = { id: toastId++, player, title, desc, tone, icon };
}
