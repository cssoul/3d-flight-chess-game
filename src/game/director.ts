import { GameEngine } from "./engine";
import { CHARACTERS, TILE_STYLE } from "./theme";
import type { SceneDef } from "./scenes/types";
import type { PlayerSetup, PlayerState, TileResolution } from "./types";
import type { SceneManager } from "../three/SceneManager";
import type { TimeOfDay } from "../three/env";
import { showToast, store } from "./store";
import { sfx } from "./sfx";
import type { CmdEntry, GameDoc, Step, TurnRecord } from "../net/types";
import type { RoomClient } from "../net/room";

const COLOR_MAP: Record<string, { color: string; deep: string }> = Object.fromEntries(
  CHARACTERS.map((c) => [c.id, { color: c.color, deep: c.deep }]),
);

export { COLOR_MAP };

const FREEZE_RES: TileResolution = {
  kind: "ice",
  effect: { t: "skip", title: "信号中断", desc: "本回合无法行动", tone: "bad" },
  moveTo: null,
  chain: false,
  win: false,
};

const THAW_RES: TileResolution = {
  kind: "plain",
  effect: { t: "none", title: "恢复", desc: "重新上线", tone: "good" },
  moveTo: null,
  chain: false,
  win: false,
};

/** turn() 录制下来、等 run() 决定下一位之后再广播的一条回合记录 */
type PendingRecord = Omit<TurnRecord, "n" | "turn" | "winner" | "phase" | "at">;

/**
 * 导演：把「规则内核」和「三维表演」串成一回合的剧本。
 *
 * 两件事在这一版里被拆开了：
 * 1. **演出**统一走 `act()` —— 它先把这一步记进剧本，再执行。单机模式下没人在意剧本，
 *    联机模式下剧本就是广播出去的东西。因为「录的」和「演的」是同一段代码，
 *    房主和看客看到的动画不可能对不上。
 * 2. **随机数只在一处产生**。骰子点数、空投内容、事件分支、和谁换位，全部发生在
 *    房主那台机器的规则内核里；其他人只回放结果，不重算。这是联机版唯一正确的做法——
 *    如果让每台机器各自 Math.random()，第一回合就会各跑各的。
 */
export class Director {
  engine: GameEngine;
  scene: SceneManager | null = null;
  /** 联机模式下的房间客户端；为 null 就是单机 */
  net: RoomClient | null = null;
  /** 非房主：不跑规则，只回放房主发来的剧本 */
  isGuest = false;

  private setups: PlayerSetup[];
  private rollResolver: (() => void) | null = null;
  private abort = false;
  private speed = 1;

  /** 当前动作的剧本 */
  private rec: Step[] = [];
  private recording = false;
  private before: PlayerState[] = [];
  private lastDice = 0;
  private pending: PendingRecord | null = null;

  /** 已经广播出去的回合数（房主端就是权威计数） */
  private playN = 0;
  private hist: TurnRecord[] = [];
  /** 回放进度：已经演到第几回合 */
  private lastPlay = 0;
  /** 回放串行队列，避免两次同步交错播放 */
  private chain: Promise<void> = Promise.resolve();

  constructor(setups: PlayerSetup[], scene: SceneDef) {
    this.setups = setups;
    this.engine = new GameEngine(setups, COLOR_MAP, scene);
  }

  /* ---------------- 装配 ---------------- */

  attach(scene: SceneManager) {
    this.scene = scene;
    scene.setPlayers(this.engine.players.map((p) => ({ color: p.color, deep: p.deep })));
    scene.setActivePlayer(0);
    scene.showHighlight(this.engine.starts[0] ?? 0, 0);
  }

  /** 第 i 个座位的起点索引（棋子高亮要按座位算，四方起点场景里每人起点不同） */
  private startOfSeat(i: number): number {
    const p = this.engine.players[i];
    return p ? this.engine.startOf(p) : 0;
  }

  setNet(net: RoomClient, isGuest: boolean) {
    this.net = net;
    this.isGuest = isGuest;
    this.playN = 0;
    this.lastPlay = 0;
    this.hist = [];
  }

  setTimeOfDay(t: TimeOfDay) {
    store.timeOfDay = t;
    this.scene?.applyTime(t);
  }

  setSpeed(v: number) {
    this.speed = v;
    store.speed = v;
  }

  updateStats() {
    if (!this.scene) return;
    store.stats = { ...this.scene.stats };
  }

  playSfx(name: keyof typeof sfx) {
    const fn = sfx[name];
    if (typeof fn === "function") (fn as () => void).call(sfx);
  }

  /* ---------------- 演出：录 + 演 ---------------- */

  private async act(s: Step) {
    if (this.recording) this.rec.push(s);
    await this.play(s);
  }

  /** 执行一个拍子。房主的实况、看客的回放，都走这一条路径。 */
  async play(s: Step): Promise<void> {
    const scene = this.scene;
    if (!scene) return;
    switch (s.t) {
      case "active":
        store.current = s.who;
        scene.setActivePlayer(s.who);
        scene.showHighlight(this.startOfSeat(s.who), this.engine.players[s.who]?.pos ?? null);
        break;

      case "wait":
        await this.wait(s.s);
        break;

      case "hint":
        store.hint = s.text;
        break;

      case "rollable":
        store.canRoll = s.v;
        break;

      case "dice":
        store.diceValue = s.value;
        store.rolling = true;
        await scene.rollDice(s.value);
        store.rolling = false;
        break;

      case "move": {
        const p = this.engine.players[s.who];
        if (p) p.pos = s.to;
        await scene.moveTo(s.who, s.from, s.to, s.mode);
        this.syncPlayers();
        scene.showHighlight(this.startOfSeat(s.who), s.to);
        break;
      }

      case "swap": {
        const a = this.engine.players[s.a];
        const b = this.engine.players[s.b];
        if (a && b) {
          const t = a.pos;
          a.pos = b.pos;
          b.pos = t;
        }
        await scene.swapPieces(s.a, s.b);
        this.syncPlayers();
        break;
      }

      case "land":
        await scene.landing(s.who, s.pos, s.fx);
        break;

      case "effect":
        await scene.playEffect(s.who, s.res);
        break;

      case "toast":
        showToast(s.who, s.title, s.desc, s.tone, s.icon);
        break;

      case "frozen":
        scene.setFrozen(s.who, s.on);
        break;

      case "shield":
        scene.setShield(s.who, s.on);
        break;

      case "finished":
        scene.setFinished(s.who, true);
        break;

      case "celebrate":
        await scene.celebrate(s.who);
        break;

      case "teleport": {
        const p = this.engine.players[s.who];
        if (p) p.pos = s.pos;
        await scene.teleport(s.who, s.pos);
        this.syncPlayers();
        break;
      }
    }
  }

  private async wait(seconds: number) {
    store.canRoll = false;
    await this.scene!.anim.delay(seconds / this.speed);
  }

  private syncPlayers() {
    store.players = this.engine.players.map((p) => ({ ...p }));
  }

  private syncLog() {
    store.log = this.engine.log.slice(0, 24).map((l) => ({ ...l }));
    store.round = this.engine.round;
    this.syncPlayers();
  }

  /* ---------------- 掷骰子的放行 ---------------- */

  /** 人类玩家点「掷骰子」 */
  releaseRoll() {
    if (this.net && this.isGuest) {
      // 看客没有规则内核，只能把「我要掷」这件事告诉房主。
      // 标签必须用房主那份权威计数（房间里的 game.plays），不能用本地的 playN ——
      // 本地 playN 在非房主端永远是 0，房主按它判「不是这一次回合」会直接丢掉请求。
      store.canRoll = false;
      void this.net.cmd("roll", { turn: this.net.game.plays ?? 0, at: Date.now() });
      return;
    }
    this.rollResolver?.();
    this.rollResolver = null;
  }

  private waitForRoll(open: boolean): Promise<void> {
    return new Promise((resolve) => {
      this.rollResolver = resolve;
      // 只有「当前行动者就是本机这个座位」时才把按钮点亮。
      // 房主要替别人的回合等骰子，但那个按钮不该是他的。
      store.canRoll = open;
    });
  }

  /** 房主收到远程掷骰请求 —— 只有「当前行动者本人、且是同一次回合」才放行 */
  onCmd(c: CmdEntry) {
    if (!this.net || this.isGuest) return;
    if (c.kind !== "roll" || !this.rollResolver) return;
    const si = this.net.seats.findIndex((s) => s.seat === c.seat);
    if (si < 0 || si !== this.engine.current) return;
    // 标签对不上说明这是上一回合残留的请求，丢掉
    if (c.data?.turn != null && c.data.turn !== this.playN) return;
    const r = this.rollResolver;
    this.rollResolver = null;
    r();
  }

  /**
   * 这一格该不该由电脑代打。
   * 联机时真人座位掉线超过阈值就交给电脑 —— 否则全桌会永远卡在「等他掷骰子」。
   */
  private isSeatAI(idx: number): boolean {
    const p = this.engine.players[idx];
    if (!p) return true;
    if (p.isAI) return true;
    if (!this.net) return false;
    const seat = this.net.seats[idx];
    if (!seat) return true;
    if (seat.seat === this.net.seat) return false;
    return !this.net.present(seat.seat);
  }

  /* ---------------- 主循环 ---------------- */

  async run() {
    const scene = this.scene!;
    await scene.playIntro();
    // 看客不跑规则：进来把镜头推完就等着收剧本
    if (this.isGuest) return;
    await this.hostLoop();
  }

  private async hostLoop() {
    while (!this.abort) {
      await this.turn();
      // 先推进到下一位再广播 —— 记录里的 turn 必须是「接下来该谁」，
      // 否则看客永远高亮上一位。终局时 nextTurn 会因为 phase 已是 result 而直接返回。
      this.engine.nextTurn();
      await this.commit();
      if (this.engine.winner) break;
    }
    if (this.engine.winner) {
      store.phase = "result";
      store.standings = this.engine.standings.map((p) => ({ ...p }));
    }
  }

  /**
   * 原房主掉线、我被顶上时调用：从房间里的权威状态接管，不重放开场镜头。
   * 接管瞬间正在播的那个回合会被丢弃 —— 看客会瞬移到 after 状态，
   * 比分是准的，只是少看一眼动画，这是不掉线优先的取舍。
   */
  async resumeHosting(doc: Partial<GameDoc>) {
    this.isGuest = false;
    this.abort = false;
    const engine = this.engine;
    engine.current = doc.turn ?? 0;
    engine.round = doc.round ?? 1;
    engine.phase = doc.phase === "over" ? "result" : "playing";
    this.playN = doc.plays ?? 0;
    this.hist = (doc.hist ?? []).slice();
    this.lastPlay = this.playN;
    this.applyStates(doc.players ?? [], doc.round);
    engine.current = doc.turn ?? 0;
    store.current = engine.current;
    this.scene!.setActivePlayer(engine.current);
    if (doc.phase === "over") {
      this.showResult(doc);
      return;
    }
    store.phase = "playing";
    await this.hostLoop();
  }

  private async turn() {
    const idx = this.engine.current;
    this.before = this.engine.players.map((p) => ({ ...p }));
    this.rec = [];
    this.recording = true;
    this.lastDice = 0;
    store.canRoll = false;
    try {
      await this.turnBody();
    } finally {
      this.recording = false;
      this.pending = {
        holder: idx,
        dice: this.lastDice,
        steps: this.rec.slice(),
        before: this.before,
        after: this.engine.players.map((p) => ({ ...p })),
        feed: this.engine.log.slice(0, 24).map((l) => ({ ...l })),
        round: this.engine.round,
      };
      // 位置一致性兜底
      this.engine.players.forEach((q, i) => void this.scene!.teleport(i, q.pos));
    }
  }

  private async turnBody() {
    const engine = this.engine;
    const idx = engine.current;
    const p = engine.players[idx];
    const ai = this.isSeatAI(idx);

    await this.act({ t: "active", who: idx });
    this.syncLog();
    engine.rolled = false;

    if (p.finished) return;

    // ---- 冻结：跳过本回合 ----
    if (engine.consumeFreeze(p)) {
      this.syncLog();
      await this.act({
        t: "toast", who: p.id, title: "信号中断",
        desc: `${p.name} 的路由仍在恢复，跳过一次行动`, tone: "bad", icon: "snow",
      });
      await this.act({ t: "effect", who: idx, res: FREEZE_RES });
      if (p.freeze === 0) {
        await this.act({ t: "wait", s: 0.5 });
        await this.act({ t: "frozen", who: idx, on: false });
        await this.act({ t: "effect", who: idx, res: THAW_RES });
      }
      await this.act({ t: "wait", s: 0.45 });
      return;
    }

    let again = false;
    let loops = 0;
    do {
      again = false;

      // ---- 掷骰 ----
      if (ai) {
        await this.act({ t: "wait", s: 0.7 });
      } else {
        const mine = !this.net || this.net.seats[idx]?.seat === this.net.seat;
        store.hint = mine ? "点击右下角掷骰子" : `等待 ${p.name} 掷骰子…`;
        await this.waitForRoll(mine);
        store.canRoll = false;
        store.hint = "";
      }
      const value = engine.roll(p);
      this.lastDice = value;
      store.diceValue = value;
      this.syncLog();
      await this.act({ t: "dice", who: idx, value });

      // ---- 主移动 ----
      const target = engine.moveTarget(p, value);
      await this.act({ t: "move", who: idx, from: p.pos, to: target, mode: "hop" });
      engine.setPos(p, target);
      this.syncLog();

      // ---- 冲线 ----
      if (engine.isWin(p)) {
        engine.finish(p);
        this.syncLog();
        await this.act({ t: "finished", who: idx });
        await this.act({ t: "celebrate", who: idx });
        engine.endGame(p);
        store.winner = { ...p };
        this.syncLog();
        return;
      }

      // ---- 落点结算（最多链 3 次）----
      let res = engine.resolveTile(p, true);
      let chain = 0;
      while (res && chain < 3) {
        const style = TILE_STYLE[res.kind];
        const icon = style.icon === "none" ? "dice" : style.icon;
        this.syncLog();
        if (res.effect.t !== "none") {
          await this.act({
            t: "toast", who: p.id,
            title: res.effect.title, desc: res.effect.desc,
            tone: res.effect.tone, icon,
          });
        }
        await this.act({ t: "land", who: idx, pos: p.pos, fx: style.fx });
        await this.act({ t: "effect", who: idx, res });
        if (res.effect.t === "skip") break;

        if (res.swapWith != null) {
          const otherIdx = engine.players.findIndex((q) => q.id === res!.swapWith);
          const other = engine.players[otherIdx];
          const aPos = p.pos;
          const bPos = other.pos;
          p.pos = bPos;
          other.pos = aPos;
          await this.act({ t: "swap", a: idx, b: otherIdx });
          this.syncLog();
          res = null;
          break;
        }

        if (res.moveTo !== null && res.moveTo !== p.pos) {
          const from = p.pos;
          const to = res.moveTo;
          await this.act({
            t: "move", who: idx, from, to,
            mode: res.effect.t === "advance" ? "boost" : "retreat",
          });
          engine.setPos(p, to);
          this.syncLog();
          if (engine.isWin(p)) {
            engine.finish(p);
            this.syncLog();
            await this.act({ t: "finished", who: idx });
            await this.act({ t: "celebrate", who: idx });
            engine.endGame(p);
            store.winner = { ...p };
            this.syncLog();
            return;
          }
          res = res.chain ? engine.resolveTile(p, false) : null;
        } else {
          res = null;
        }
        chain++;
      }

      if (engine.tileKindAt(p) === "dash") again = true;
      if (p.freeze > 0) {
        await this.act({ t: "frozen", who: idx, on: true });
        again = false;
      }
      loops++;
      if (loops >= 3) again = false;
      if (again) {
        await this.act({ t: "wait", s: 0.35 });
        await this.act({
          t: "toast", who: p.id, title: "再掷一次",
          desc: `${p.name} 的推进器仍在充能`, tone: "good", icon: "bolt",
        });
      }
    } while (again && !this.abort);

    await this.act({ t: "wait", s: 0.45 });
  }

  /* ---------------- 房主：广播 ---------------- */

  private async commit() {
    const net = this.net;
    if (!net || this.isGuest || !this.pending) return;
    const engine = this.engine;
    const rec: TurnRecord = {
      ...this.pending,
      n: ++this.playN,
      turn: engine.current,
      winner: engine.winner ? engine.winner.id : -1,
      phase: engine.phase === "result" ? "over" : "playing",
      at: Date.now(),
    };
    this.pending = null;
    this.hist.push(rec);
    if (this.hist.length > 8) this.hist.shift();

    const game: GameDoc = {
      setups: this.setups,
      scene: engine.scene.id,
      turn: engine.current,
      round: engine.round,
      plays: this.playN,
      phase: rec.phase,
      players: rec.after,
      winner: rec.winner,
      hist: this.hist.slice(),
    };
    await net.push({
      game,
      feed: rec.feed,
      status: rec.phase === "over" ? "over" : "playing",
    });
  }

  /* ---------------- 看客：同步与回放 ---------------- */

  /** 把整盘棋瞬移到给定状态（换人 / 补齐缺口用，不放动画） */
  private applyStates(list: PlayerState[], round?: number) {
    const scene = this.scene!;
    list.forEach((p, i) => {
      const cur = this.engine.players[i];
      if (cur) Object.assign(cur, p);
    });
    if (round != null) this.engine.round = round;
    this.syncPlayers();
    store.round = this.engine.round;
    list.forEach((p, i) => {
      void scene.teleport(i, p.pos);
      scene.setFrozen(i, p.freeze > 0);
      scene.setShield(i, p.shield > 0);
      scene.setFinished(i, p.finished);
    });
    const cur = this.engine.players[this.engine.current];
    scene.setActivePlayer(this.engine.current);
    scene.showHighlight(this.startOfSeat(this.engine.current), cur ? cur.pos : null);
  }

  /** 房间快照有更新时调用；内部排队，不会两次回放交叠 */
  onRoomDoc(doc: Partial<GameDoc>, feed: TurnRecord["feed"]) {
    const scene = this.scene;
    if (!this.isGuest || !scene) return;
    const plays = doc.plays ?? 0;
    if (plays <= this.lastPlay) return;

    const hist = doc.hist ?? [];
    const gap = plays - this.lastPlay;
    const missed = hist.filter((r) => r.n > this.lastPlay && r.n <= plays).sort((a, b) => a.n - b.n);
    this.lastPlay = plays;

    // 缺口比历史还长（掉线太久）：直接硬同步到最新状态，不补播中间过程
    if (!missed.length || gap > hist.length) {
      this.chain = this.chain.then(() => {
        if (this.abort) return;
        this.applyStates(doc.players ?? [], doc.round);
        this.engine.current = doc.turn ?? 0;
        store.current = this.engine.current;
        this.scene!.setActivePlayer(this.engine.current);
        store.log = feed.slice(0, 24).map((l) => ({ ...l }));
        if (doc.phase === "over") this.showResult(doc);
      });
      return;
    }

    this.chain = this.chain.then(async () => {
      for (const rec of missed) {
        if (this.abort) return;
        await this.playRecord(rec);
      }
      if (doc.phase === "over") this.showResult(doc);
    });
  }

  private async playRecord(rec: TurnRecord) {
    this.applyStates(rec.before, rec.round);
    for (const s of rec.steps) {
      if (this.abort) return;
      await this.play(s);
    }
    this.applyStates(rec.after, rec.round);
    this.engine.current = rec.turn;
    store.current = rec.turn;
    this.scene!.setActivePlayer(rec.turn);
    store.log = rec.feed.slice(0, 24).map((l) => ({ ...l }));
    if (rec.phase === "over") this.showResult({ players: rec.after, winner: rec.winner });
  }

  private showResult(doc: Partial<GameDoc>) {
    const players = doc.players ?? [];
    const w = players.find((p) => p.id === doc.winner) ?? null;
    store.winner = w ? { ...w } : null;
    const rest = players
      .filter((p) => !w || p.id !== w.id)
      .sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9));
    store.standings = (w ? [{ ...w }, ...rest] : rest).map((p) => ({ ...p }));
    store.canRoll = false;
    store.phase = "result";
  }

  stop() {
    this.abort = true;
    this.rollResolver = null;
    this.scene?.anim.clear();
  }
}
