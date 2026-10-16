import { TILE_STYLE, type TileKind } from "./theme";
import type { SceneDef } from "./scenes/types";
import type { Effect, LogEntry, PlayerSetup, PlayerState, TileResolution, Tone } from "./types";

let logSeed = 1;

function randInt(n: number) {
  return Math.floor(Math.random() * n);
}

function pick<T>(arr: T[]): T {
  return arr[randInt(arr.length)];
}

/**
 * 纯规则内核：不碰 three、不碰 DOM，只维护「谁在哪、发生了什么」。
 * 所有表演（棋子跳动、骰子翻滚、粒子）都由导演层读取它吐出的 TileResolution 来播放。
 *
 * 它同时不碰「棋盘长什么样」：格子在哪、一格是什么事件、走多少步算赢，
 * 全部问手里的 SceneDef。换棋盘 = 换一个 SceneDef 传进来，这个文件一行不用改。
 */
export class GameEngine {
  players: PlayerState[] = [];
  current = 0;
  phase: "playing" | "result" = "playing";
  winner: PlayerState | null = null;
  standings: PlayerState[] = [];
  log: LogEntry[] = [];
  round = 1;
  /** 本回合是否已经掷过骰子（人类玩家点按钮用） */
  rolled = false;

  /** 当前棋盘 */
  readonly scene: SceneDef;
  /** 每个座位的起点环道索引 */
  readonly starts: number[];

  constructor(
    setups: PlayerSetup[],
    colors: Record<string, { color: string; deep: string }>,
    scene: SceneDef,
  ) {
    this.scene = scene;
    this.starts = scene.starts(Math.max(1, setups.length));
    this.players = setups.map((s) => ({
      id: s.id,
      name: s.name,
      charId: s.charId,
      color: colors[s.charId]?.color ?? "#888",
      deep: colors[s.charId]?.deep ?? "#444",
      isAI: s.isAI,
      pos: 0,
      freeze: 0,
      shield: 0,
      finished: false,
      rank: null,
      rollCount: 0,
      lastRoll: 0,
    }));
  }

  /** 某位玩家的起点索引（棋子渲染、格子查询都走它） */
  startOf(p: PlayerState): number {
    return this.starts[p.id] ?? 0;
  }

  /** 某位玩家踩在哪一格 */
  tileKindAt(p: PlayerState, pos = p.pos): TileKind {
    return this.scene.kind(this.startOf(p), pos);
  }

  get active() {
    return this.players;
  }

  player(id: number) {
    return this.players.find((p) => p.id === id)!;
  }

  me(): PlayerState {
    return this.players[this.current];
  }

  push(player: PlayerState, title: string, desc: string, tone: Tone, icon: string) {
    this.log.unshift({ id: logSeed++, player: player.id, title, desc, tone, icon });
    if (this.log.length > 40) this.log.pop();
  }

  /** 回合开始：处理冻结 */
  consumeFreeze(p: PlayerState): boolean {
    if (p.freeze > 0) {
      p.freeze -= 1;
      this.push(p, "信号中断", `${p.name} 的路由被冻结，本回合无法行动。`, "bad", "snow");
      return true;
    }
    return false;
  }

  roll(p: PlayerState): number {
    const v = 1 + randInt(6);
    p.lastRoll = v;
    p.rollCount += 1;
    this.push(p, `掷出 ${v} 点`, `${p.name} 启动引擎，前进 ${v} 格。`, "neutral", "dice");
    return v;
  }

  /** 目标位置（到达或越过起点线即冲线） */
  moveTarget(p: PlayerState, steps: number): number {
    return Math.min(this.scene.lap, p.pos + steps);
  }

  retreatTarget(p: PlayerState, steps: number): number {
    return Math.max(0, p.pos - steps);
  }

  setPos(p: PlayerState, pos: number) {
    p.pos = Math.max(0, Math.min(this.scene.lap, pos));
  }

  isWin(p: PlayerState) {
    return p.pos >= this.scene.lap;
  }

  /** 落地结算：返回给渲染层播放的指令 */
  resolveTile(p: PlayerState, allowChain: boolean): TileResolution | null {
    if (p.pos >= this.scene.lap) return null;
    const kind = this.tileKindAt(p);
    const fx = TILE_STYLE[kind].fx;
    void fx;

    const negative = (): boolean => {
      if (p.shield > 0) {
        p.shield -= 1;
        this.push(p, "护盾抵挡", `${p.name} 的护盾吸收了这次冲击。`, "good", "shield");
        return true;
      }
      return false;
    };

    const res = (
      effect: Effect,
      moveTo: number | null,
      chain = false,
      swapWith?: number,
    ): TileResolution => ({
      kind,
      effect,
      moveTo,
      chain,
      swapWith,
      win: moveTo !== null && moveTo >= this.scene.lap,
    });

    switch (kind) {
      case "start":
      case "plain":
      /** 登顶航道：只负责把棋子送到中央，不触发任何事件 */
      case "home":
        return null;

      case "forward": {
        const n = 2;
        this.push(p, "磁悬浮滑道", `${p.name} 被滑道推动，前进 ${n} 格。`, "good", "arrow");
        return res({ t: "advance", n, title: "磁悬浮滑道", desc: `前进 ${n} 格`, tone: "good" },
          Math.min(this.scene.lap, p.pos + n), allowChain);
      }

      case "boost": {
        const n = 3;
        this.push(p, "星轨加速", `${p.name} 接入星轨，猛冲 ${n} 格。`, "good", "star");
        return res({ t: "advance", n, title: "星轨加速", desc: `前进 ${n} 格`, tone: "good" },
          Math.min(this.scene.lap, p.pos + n), allowChain);
      }

      case "dash": {
        this.push(p, "疾风跑道", `${p.name} 完成充能，前进 1 格并再掷一次。`, "good", "bolt");
        return res({ t: "again", title: "疾风跑道", desc: "前进 1 格 · 再掷一次", tone: "good" },
          Math.min(this.scene.lap, p.pos + 1), false);
      }

      case "portal": {
        const n = 5;
        this.push(p, "环线跃迁", `${p.name} 穿过跃迁门，瞬移 ${n} 格。`, "good", "rocket");
        return res({ t: "advance", n, title: "环线跃迁", desc: `前进 ${n} 格`, tone: "good" },
          Math.min(this.scene.lap, p.pos + n), allowChain);
      }

      case "shield": {
        p.shield = Math.min(2, p.shield + 1);
        this.push(p, "防护罩", `${p.name} 展开护盾，可抵挡一次负面事件。`, "good", "shield");
        return res({ t: "shield", title: "防护罩", desc: "获得 1 层护盾", tone: "good" }, null);
      }

      case "gift": {
        const roll = pick(["advance2", "advance4", "shield", "again"] as const);
        if (roll === "advance2" || roll === "advance4") {
          const n = roll === "advance2" ? 2 : 4;
          this.push(p, "无人机空投", `${p.name} 收到加速补给，前进 ${n} 格。`, "good", "gift");
          return res({ t: "advance", n, title: "无人机空投", desc: `前进 ${n} 格`, tone: "good" },
            Math.min(this.scene.lap, p.pos + n), allowChain);
        }
        if (roll === "shield") {
          p.shield = Math.min(2, p.shield + 1);
          this.push(p, "无人机空投", `${p.name} 收到防护补给。`, "good", "shield");
          return res({ t: "shield", title: "无人机空投", desc: "获得 1 层护盾", tone: "good" }, null);
        }
        this.push(p, "无人机空投", `${p.name} 收到推进器，再掷一次。`, "good", "dice");
        return res({ t: "again", title: "无人机空投", desc: "再掷一次", tone: "good" }, null);

      }

      case "quiz": {
        const roll = pick(["advance3", "retreat2", "skip", "shield"] as const);
        if (roll === "advance3") {
          this.push(p, "都会事件", `${p.name} 遇上顺风，前进 3 格。`, "good", "question");
          return res({ t: "advance", n: 3, title: "都会事件 · 顺风", desc: "前进 3 格", tone: "good" },
            Math.min(this.scene.lap, p.pos + 3), allowChain);
        }
        if (roll === "shield") {
          p.shield = Math.min(2, p.shield + 1);
          this.push(p, "都会事件", `${p.name} 捡到一块备用电池（护盾）。`, "good", "question");
          return res({ t: "shield", title: "都会事件 · 备用电池", desc: "获得 1 层护盾", tone: "good" }, null);
        }
        if (roll === "skip") {
          if (negative()) return res({ t: "blocked", title: "都会事件 · 路障", desc: "护盾抵挡", tone: "good" }, null);
          p.freeze += 1;
          this.push(p, "都会事件", `${p.name} 被路口红波拦下，暂停一回合。`, "bad", "question");
          return res({ t: "skip", title: "都会事件 · 红灯", desc: "暂停一回合", tone: "bad" }, null);
        }
        if (negative()) return res({ t: "blocked", title: "都会事件 · 逆风", desc: "护盾抵挡", tone: "good" }, null);
        this.push(p, "都会事件", `${p.name} 遭遇逆风，后退 2 格。`, "bad", "question");
        return res({ t: "retreat", n: 2, title: "都会事件 · 逆风", desc: "后退 2 格", tone: "bad" },
          this.retreatTarget(p, 2), false);
      }

      case "barrier": {
        if (negative()) return res({ t: "blocked", title: "施工路段", desc: "护盾抵挡", tone: "good" }, null);
        this.push(p, "施工路段", `${p.name} 撞上围挡，后退 2 格。`, "bad", "cone");
        return res({ t: "retreat", n: 2, title: "施工路段", desc: "后退 2 格", tone: "bad" },
          this.retreatTarget(p, 2), false);
      }

      case "ice": {
        if (negative()) return res({ t: "blocked", title: "信号中断", desc: "护盾抵挡", tone: "good" }, null);
        p.freeze += 1;
        this.push(p, "信号中断", `${p.name} 的导航被冻结，暂停一回合。`, "bad", "snow");
        return res({ t: "skip", title: "信号中断", desc: "暂停一回合", tone: "bad" }, null);
      }

      case "swap": {
        const others = this.players.filter((q) => q.id !== p.id && q.pos < this.scene.lap && !q.finished);
        if (!others.length) return null;
        if (negative()) return res({ t: "blocked", title: "换乘枢纽", desc: "护盾抵挡", tone: "good" }, null);
        const other = pick(others);
        this.push(p, "换乘枢纽", `${p.name} 与 ${other.name} 互换位置！`, "neutral", "swap");
        return res({ t: "swap", title: "换乘枢纽", desc: `与 ${other.name} 互换`, tone: "neutral" },
          other.pos, false, other.id);
      }
      default:
        return null;
    }
  }

  finish(p: PlayerState) {
    p.finished = true;
    p.rank = this.standings.length + 1;
    this.standings.push(p);
    this.push(p, `${this.scene.winWord}！`, this.scene.winLog(p.name, p.rank), "good", "flag");
  }

  nextTurn() {
    if (this.phase === "result") return;
    let guard = 0;
    do {
      this.current = (this.current + 1) % this.players.length;
      if (this.current === 0) this.round += 1;
      guard++;
    } while (this.players[this.current].finished && guard < this.players.length * 2);
    this.rolled = false;
  }

  endGame(winner: PlayerState) {
    this.phase = "result";
    this.winner = winner;
    const rest = this.players
      .filter((p) => p.id !== winner.id)
      .sort((a, b) => b.pos - a.pos);
    this.standings = [winner, ...rest];
    this.standings.forEach((p, i) => {
      p.rank = i + 1;
    });
  }
}

/** 供 UI 展示的格型说明 */
export function kindStyle(kind: TileKind) {
  return TILE_STYLE[kind];
}
