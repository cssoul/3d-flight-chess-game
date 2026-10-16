import { rpc } from "./cloud";
import {
  reasonText,
  type CmdEntry,
  type RoomRow,
  type RpcResult,
  type SeatInfo,
} from "./types";

export interface NetHooks {
  onRoom?: (room: RoomRow) => void;
  /** 只对房主有意义：别人请求掷骰子 */
  onCmd?: (cmd: CmdEntry) => void;
  onError?: (msg: string) => void;
  /** 房间已经不存在了 */
  onGone?: () => void;
}

/** 座位多久没心跳就当作掉线（服务端 epoch 秒）。 */
export const PRESENCE_SEC = 15;
const BEAT_MS = 4200;
const POLL_PLAYING_MS = 520;
const POLL_LOBBY_MS = 900;
const IDENTITY_KEY = "skyline-rally.identity.v1";

interface Identity {
  code: string;
  seat: string;
  token: string;
}

function rid(len: number): string {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  // 去掉 0/o/1/l 这类看错的字符 —— 座位号偶尔要念给别人听
  const A = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += A[buf[i] % A.length];
  return s;
}

function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Identity;
    return v?.code && v?.seat && v?.token ? v : null;
  } catch {
    return null;
  }
}

function saveIdentity(v: Identity | null) {
  try {
    if (v) localStorage.setItem(IDENTITY_KEY, JSON.stringify(v));
    else localStorage.removeItem(IDENTITY_KEY);
  } catch {
    /* 隐私模式下 localStorage 会抛，忽略即可 —— 只是失去刷新续连 */
  }
}

/**
 * 房间客户端：一个静态站点 + 一个中心房间表，没有长连接可用，
 * 所以一切靠「轮询快照 + 比较交换写入」。
 *
 * - 轮询：`room_get(code, 我持有的 rev)`，rev 没涨就只回一行，几乎不耗流量；
 * - 写入：`room_push(code, …, p_rev = 我持有的 rev)`，rev 对不上就返回 conflict，
 *   由调用方重取最新状态后重试 —— 这是唯一能防住「两个人同时点」的机制；
 * - 指令：`room_cmd` 走服务端追加，不走比较交换，避免抢同一个 rev；
 * - 心跳：`room_beat` 只更新自己那一格的 seen，用来判断谁在线。
 */
export class RoomClient {
  code = "";
  seat = "";
  token = "";
  rev = -1;
  room: RoomRow | null = null;
  hostSeat = "";
  online = false;
  hooks: NetHooks = {};

  private timer: number | null = null;
  private stopped = true;
  private busy = false;
  private lastBeatAt = 0;
  /** 已派发到的指令序号；-1 表示还没拿到过房间快照 */
  private lastCmdN = -1;
  private claimAt = 0;
  private claiming = false;
  /**
   * 服务端时间 - 本地时间。判定「谁掉线」比的是服务端写下的 seen，
   * 直接用本地 Date.now() 会被本机时钟快/慢几十分钟的机器判成全员离线，
   * 于是房主把真人座位全部当成电脑托管。每次 room_get 都会顺手校准一次。
   */
  private skew = 0;

  /** 校正后的当前时间（epoch 秒） */
  private nowSec() {
    return Date.now() / 1000 + this.skew;
  }

  get active() {
    return this.code !== "" && this.seat !== "";
  }

  get isHost() {
    return this.active && this.hostSeat === this.seat;
  }

  get seats(): SeatInfo[] {
    return this.room?.seats ?? [];
  }

  get myIndex() {
    return this.seats.findIndex((s) => s.seat === this.seat);
  }

  get game() {
    return this.room?.game ?? {};
  }

  status(): RoomRow["status"] {
    return this.room?.status ?? "lobby";
  }

  /** 某个座位现在还在不在线 */
  present(seat: string, nowSec = this.nowSec()): boolean {
    const s = this.seats.find((x) => x.seat === seat);
    if (!s) return false;
    if (s.seat === this.seat) return true;
    return nowSec - s.seen < PRESENCE_SEC;
  }

  private pollMs() {
    return this.room?.status === "playing" ? POLL_PLAYING_MS : POLL_LOBBY_MS;
  }

  /* ---------------- 生命周期 ---------------- */

  private async rpcCall(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
    const { data, error } = await rpc<RpcResult | RpcResult[]>(fn, args);
    if (error) {
      const msg = (error as { message?: string })?.message ?? String(error);
      throw new Error(msg);
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("云服务返回了空结果");
    return row;
  }

  private attach(code: string, seat: string, token: string) {
    this.code = code;
    this.seat = seat;
    this.token = token;
    this.rev = -1;
    this.room = null;
    this.hostSeat = "";
    this.lastCmdN = -1;
    this.lastBeatAt = 0;
    saveIdentity({ code, seat, token });
  }

  async create(name: string, charId: string): Promise<RpcResult> {
    const seat = "s" + rid(8);
    const token = rid(24);
    const r = await this.rpcCall("room_create", { p_name: name, p_seat: seat, p_token: token });
    if (!r.ok) throw new Error(reasonText(r.reason));
    this.attach(r.room!.code, seat, token);
    this.absorb(r);
    // 建房时建表函数只写了名字，角色要单独补一次（和自己的座位同一套接口）
    await this.updateSeat(name, charId);
    return r;
  }

  async join(code: string, name: string, charId: string): Promise<RpcResult> {
    const seat = "s" + rid(8);
    const token = rid(24);
    const r = await this.rpcCall("room_join", {
      p_code: code,
      p_seat: seat,
      p_token: token,
      p_name: name,
    });
    if (!r.ok) throw new Error(reasonText(r.reason));
    this.attach(r.room!.code, seat, token);
    this.absorb(r);
    await this.updateSeat(name, charId);
    return r;
  }

  /** 只改自己那一格：昵称 / 角色，不影响别人 */
  async updateSeat(name: string, charId: string) {
    if (!this.active) return;
    const r = await this.rpcCall("room_seat", {
      p_code: this.code,
      p_seat: this.seat,
      p_token: this.token,
      p_name: name,
      p_char: charId,
    });
    if (r.ok) this.absorb(r);
  }

  /** 刷新页面后自动续连（同一个房间 + 同一个座位） */
  async resume(): Promise<boolean> {
    const id = loadIdentity();
    if (!id) return false;
    this.code = id.code;
    this.seat = id.seat;
    this.token = id.token;
    const r = await this.rpcCall("room_join", {
      p_code: id.code,
      p_seat: id.seat,
      p_token: id.token,
      p_name: "",
    });
    if (!r.ok) {
      saveIdentity(null);
      this.code = "";
      this.seat = "";
      this.token = "";
      return false;
    }
    this.rev = -1;
    this.lastCmdN = -1;
    this.absorb(r);
    return true;
  }

  start() {
    if (this.stopped === false) return;
    this.stopped = false;
    void this.tick();
  }

  stop() {
    this.stopped = true;
    if (this.timer != null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async leave() {
    this.stop();
    saveIdentity(null);
    this.code = "";
    this.seat = "";
    this.token = "";
    this.rev = -1;
    this.room = null;
    this.hostSeat = "";
    this.lastCmdN = -1;
    this.online = false;
  }

  /* ---------------- 轮询 ---------------- */

  private schedule() {
    if (this.stopped) return;
    if (this.timer != null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.tick(), this.pollMs());
  }

  private async tick() {
    if (this.stopped || !this.active) return;
    if (this.busy) {
      this.schedule();
      return;
    }
    this.busy = true;
    try {
      const now = Date.now();
      let r: RpcResult;
      if (now - this.lastBeatAt >= BEAT_MS) {
        this.lastBeatAt = now;
        r = await this.rpcCall("room_beat", {
          p_code: this.code,
          p_seat: this.seat,
          p_token: this.token,
        });
      } else {
        r = await this.rpcCall("room_get", { p_code: this.code, p_rev: this.rev });
      }
      this.absorb(r);
      if (!this.online) {
        this.online = true;
        this.hooks.onRoom?.(this.room!);
      }
      this.maybeClaimHost();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "网络异常";
      if (this.online) {
        this.online = false;
        this.hooks.onError?.("与服务器断开，正在重连…");
      } else {
        this.hooks.onError?.(msg);
      }
    } finally {
      this.busy = false;
      this.schedule();
    }
  }

  /** 把一次服务端返回吸收进本地状态，并派发新指令 / 新快照 */
  private absorb(r: RpcResult) {
    if (typeof r.rev === "number") this.rev = r.rev;
    if (typeof r.serverNow === "number") this.skew = r.serverNow - Date.now() / 1000;
    if (r.ok === false && r.reason === "not_found") {
      this.hooks.onGone?.();
      this.stop();
      return;
    }
    if (!r.room) return;
    this.room = r.room;
    this.hostSeat = r.room.host_seat;

    // 指令派发。首次拿到快照时只记水位、不补发历史指令 ——
    // 否则刚入座的人会把房间里攒下的旧「掷骰」请求当成新的，替别人直接掷一次。
    const cmds = r.room.cmds ?? [];
    if (this.lastCmdN < 0) {
      this.lastCmdN = cmds.length ? cmds[cmds.length - 1].n : 0;
    } else {
      for (const c of cmds) {
        if (c.n <= this.lastCmdN) continue;
        this.lastCmdN = c.n;
        this.hooks.onCmd?.(c);
      }
    }

    this.hooks.onRoom?.(r.room);
  }

  /* ---------------- 写入 ---------------- */

  /**
   * 比较交换写入。rev 被别人的心跳顶掉时会返回 conflict —— 那不是错误，
   * 拿到最新 rev 后原样重放即可（调用方每次都提交完整状态，所以重放是安全的）。
   */
  async push(patch: Record<string, unknown>, retries = 5): Promise<boolean> {
    if (!this.active) return false;
    for (let i = 0; i < retries; i++) {
      const r = await this.rpcCall("room_push", {
        p_code: this.code,
        p_seat: this.seat,
        p_token: this.token,
        p_rev: this.rev,
        p_patch: patch,
      });
      if (r.ok) {
        this.absorb(r);
        return true;
      }
      if (r.reason === "conflict") {
        this.absorb(r);
        continue;
      }
      this.hooks.onError?.(reasonText(r.reason));
      return false;
    }
    this.hooks.onError?.("状态同步失败，请检查网络。");
    return false;
  }

  /** 服务端追加型指令，不参与比较交换 */
  async cmd(kind: string, data: unknown = null) {
    if (!this.active) return;
    const r = await this.rpcCall("room_cmd", {
      p_code: this.code,
      p_seat: this.seat,
      p_token: this.token,
      p_kind: kind,
      p_data: data,
    });
    if (r.ok) this.absorb(r);
  }

  /**
   * 房主接管：房主掉线超过一定时间后，在线座位里序号最小的那个人顶上。
   * 不接管的话整局会永远卡在「等房主动作」上。
   */
  private maybeClaimHost() {
    if (!this.active || !this.room) return;
    if (this.isHost) return;
    const now = Date.now();
    if (now - this.claimAt < 6000 || this.claiming) return;
    const nowSec = this.nowSec();
    const hs = this.room.seats.find((s) => s.seat === this.hostSeat);
    if (hs && nowSec - hs.seen < PRESENCE_SEC + 4) return;
    const online = this.room.seats.filter(
      (s) => s.seat === this.seat || nowSec - s.seen < PRESENCE_SEC + 4,
    );
    if (!online.length || online[0].seat !== this.seat) return;
    this.claimAt = now;
    this.claiming = true;
    void this.push({ host_seat: this.seat }).finally(() => {
      this.claiming = false;
    });
  }
}

/** 全应用共用一个房间客户端 */
export const session = new RoomClient();
