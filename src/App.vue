<template>
  <GameCanvas @ready="onSceneReady" />

  <Lobby
    v-if="store.phase === 'lobby'"
    @start="startLocal"
    @create="onCreate"
    @join="onJoin"
    @seat="onSeat"
    @begin="onBegin"
    @leave="onLeave"
    @scene="onScene"
  />
  <Hud
    v-else
    :view="view"
    :auto-rotate="autoRotate"
    @roll="onRoll"
    @time="onTime"
    @view="onView"
    @autorotate="onAutoRotate"
    @speed="onSpeed"
    @sound="onSound"
    @restart="restart"
    @scene="onScene"
  />
  <ResultOverlay
    v-if="store.phase === 'result'"
    @again="restart"
    @lobby="backToLobby"
  />

  <transition name="fade">
    <div v-if="!store.sceneReady" class="booting">
      <div class="boot-card frost">
        <div class="spin"></div>
        <p>正在生成云顶都会…</p>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import GameCanvas from "./components/GameCanvas.vue";
import Lobby from "./components/Lobby.vue";
import Hud from "./components/Hud.vue";
import ResultOverlay from "./components/ResultOverlay.vue";
import { SceneManager } from "./three/SceneManager";
import { Director } from "./game/director";
import { emptyNet, showToast, store } from "./game/store";
import { getScene, setScene } from "./game/scenes";
import { sfx } from "./game/sfx";
import { session } from "./net/room";
import { newGameDoc, setupsFromSeats } from "./net/match";
import type { GameDoc, RoomRow } from "./net/types";
import type { PlayerSetup } from "./game/types";
import type { TimeOfDay } from "./three/env";

const scene = shallowRef<SceneManager | null>(null);
const director = shallowRef<Director | null>(null);
const view = ref(0);
const autoRotate = ref(false);

/** 本局是不是联机局 */
let matchOnline = false;
/** 已经为哪一「回合序号」掷过骰子了，防止连点两次 */
let rollSentFor = -1;
let promoting = false;
let toastTimer: number | null = null;
let statsTimer: number | null = null;
let errTimer: number | null = null;

const VIEWS: [number, number][] = [
  [45, 35],
  [45, 68],
  [45, 18],
];

const errText = (e: unknown) => (e instanceof Error ? e.message : "操作失败，请重试。");

function flashError(m: string) {
  store.net.error = m;
  if (errTimer) window.clearTimeout(errTimer);
  errTimer = window.setTimeout(() => {
    store.net.error = "";
  }, 4200);
}

/* ---------------- 场景 ---------------- */

function onSceneReady(raw: unknown) {
  const s = raw as SceneManager;
  scene.value = s;
  store.sceneReady = true;
  statsTimer = window.setInterval(() => {
    store.stats = { ...s.stats };
  }, 700);
  // 场景比房间晚就绪是常态（建房可能在 WebGL 初始化之前完成）
  advance();
}

/* ---------------- 棋盘 ---------------- */

/**
 * 换棋盘。
 * - 在大厅点：只是把预览的沙盘换掉，等开局就用这张盘；
 * - 在对局中（设置弹窗）点：Hud 会顺手 emit restart，退回大厅重新开一局 ——
 *   棋子落位和整局剧本都是照着棋盘几何算出来的，不允许半路换盘。
 */
function onScene(id: string) {
  const def = setScene(id);
  scene.value?.applyScene(def);
}

/* ---------------- 开局 ---------------- */

function beginMatch(players: PlayerSetup[], online: boolean, sceneId?: string) {
  const s = scene.value;
  if (!s || director.value) return;
  // 联机局的棋盘由房主写进房间文档，看客跟着走（不落盘，别覆盖本机自己的选择）
  const def = setScene(sceneId ?? getScene().id, !sceneId);
  s.applyScene(def);
  sfx.resume();
  sfx.setEnabled(store.sound);
  s.applyTime(store.timeOfDay);
  store.winner = null;
  store.standings = [];
  store.log = [];
  store.toast = null;
  store.hint = "";
  store.canRoll = false;

  const d = new Director(players, def);
  d.attach(s);
  d.setSpeed(store.speed);
  if (online) d.setNet(session, session.isHost === false);
  director.value = d;
  matchOnline = online;
  rollSentFor = -1;

  store.players = d.engine.players.map((p) => ({ ...p }));
  store.current = 0;
  store.round = 1;
  store.diceValue = 0;
  store.phase = "playing";
  void d.run();
}

function startLocal(cfg: { players: PlayerSetup[] }) {
  beginMatch(cfg.players, false);
}

/** 房间状态满足开局条件、且场景已就绪时进局；场景未就绪就等 onSceneReady 再来一次 */
function advance() {
  const room = session.room;
  if (!room || !scene.value || director.value) return;
  const g = (room.game ?? {}) as Partial<GameDoc>;
  if (room.status !== "lobby" && g.setups?.length) beginMatch(g.setups, true, g.scene);
}

/* ---------------- 房间 ---------------- */

function syncNetState(room: RoomRow) {
  const net = store.net;
  net.active = true;
  net.code = room.code;
  net.seatIndex = session.myIndex;
  net.isHost = session.isHost;
  net.online = session.online;
  net.status = room.status;
  net.seats = room.seats.map((s, i) => ({
    seat: s.seat,
    name: s.name || `玩家${i + 1}`,
    charId: s.charId,
    isMe: s.seat === session.seat,
    isHost: s.seat === room.host_seat,
    online: session.present(s.seat),
  }));
  net.aiTakeover =
    room.status === "playing"
      ? room.seats.map((s, i) => (session.present(s.seat) ? -1 : i)).filter((i) => i >= 0)
      : [];
}

function handleRoom(room: RoomRow) {
  syncNetState(room);
  const g = (room.game ?? {}) as Partial<GameDoc>;

  // 房主把局收掉 → 全员退回房间大厅
  if (room.status === "lobby") {
    if (director.value) {
      director.value.stop();
      director.value = null;
      matchOnline = false;
      store.phase = "lobby";
      store.players = [];
      store.winner = null;
      store.standings = [];
      store.canRoll = false;
      store.hint = "";
    }
    return;
  }

  advance();

  const d = director.value;
  if (!d) return;
  if (session.isHost && d.isGuest && !promoting) {
    promoting = true;
    void d.resumeHosting(g).finally(() => {
      promoting = false;
    });
  }
  if (d.isGuest) d.onRoomDoc(g, room.feed ?? []);
  updateCanRoll();
}

function updateCanRoll() {
  // 单机局的按钮由导演在 waitForRoll 里直接接管，这里只算联机局
  if (!director.value || !matchOnline) return;
  const g = session.game;
  const plays = g.plays ?? 0;
  if (rollSentFor >= 0 && plays > rollSentFor) rollSentFor = -1;
  const myTurn =
    session.status() === "playing" &&
    store.phase === "playing" &&
    session.myIndex >= 0 &&
    (g.turn ?? -1) === session.myIndex;
  store.canRoll = myTurn && session.online && !store.rolling && rollSentFor < 0;
}

async function onCreate(name: string, charId: string) {
  store.net.busy = "create";
  store.net.error = "";
  try {
    await session.create(name, charId);
    session.start();
  } catch (e) {
    flashError(errText(e));
  } finally {
    store.net.busy = "";
  }
}

async function onJoin(code: string, name: string, charId: string) {
  const clean = code.trim().toUpperCase();
  if (clean.length < 4) {
    flashError("房间号是 5 位字符，再确认一下。");
    return;
  }
  store.net.busy = "join";
  store.net.error = "";
  try {
    await session.join(clean, name, charId);
    session.start();
  } catch (e) {
    flashError(errText(e));
  } finally {
    store.net.busy = "";
  }
}

function onSeat(name: string, charId: string) {
  void session.updateSeat(name, charId).catch(() => undefined);
}

async function onBegin() {
  const room = session.room;
  if (!room || !session.isHost) return;
  const setups = setupsFromSeats(room);
  await session.push({ status: "playing", game: newGameDoc(setups, getScene()), feed: [] });
}

async function onLeave() {
  await session.leave();
  store.net = emptyNet();
}

/* ---------------- HUD ---------------- */

function onRoll() {
  const d = director.value;
  if (!d) return;
  if (matchOnline) {
    rollSentFor = session.game.plays ?? 0;
    store.canRoll = false;
  }
  d.releaseRoll();
}

function onTime(v: TimeOfDay) {
  store.timeOfDay = v;
  director.value?.setTimeOfDay(v);
  scene.value?.applyTime(v);
}

function onView(v: number) {
  view.value = v;
  const [az, el] = VIEWS[v];
  scene.value?.setView(az, el);
}

function onAutoRotate(v: boolean) {
  autoRotate.value = v;
  if (scene.value) scene.value.autoRotate = v;
}

function onSpeed(v: number) {
  store.speed = v;
  director.value?.setSpeed(v);
}

function onSound(v: boolean) {
  store.sound = v;
  sfx.setEnabled(v);
  if (v) sfx.click();
}

/* ---------------- 重开 ---------------- */

async function restart() {
  // 联机局：只有房主能把房间打回大厅，其他人跟着广播走 —— 否则每个人都点得动，
  // 四个客户端会互相把对方的状态覆盖掉。
  if (matchOnline && session.active) {
    if (session.isHost) await session.push({ status: "lobby", game: {}, feed: [] });
    else showToast(-1, "等待房主", "这一局由房主决定要不要再来一次", "neutral", "dice");
    return;
  }
  director.value?.stop();
  director.value = null;
  matchOnline = false;
  store.phase = "lobby";
  store.winner = null;
  store.standings = [];
  store.toast = null;
  store.players = [];
  store.canRoll = false;
  store.hint = "";
  autoRotate.value = false;
  if (scene.value) {
    scene.value.autoRotate = false;
    scene.value.setView(45, 35);
    scene.value.setZoom(1);
  }
}

function backToLobby() {
  void restart();
}

/* ---------------- 网络接线 ---------------- */

session.hooks = {
  onRoom: handleRoom,
  onCmd: (c) => director.value?.onCmd(c),
  onError: (m) => flashError(m),
  onGone: () => {
    if (director.value) {
      director.value.stop();
      director.value = null;
    }
    matchOnline = false;
    store.phase = "lobby";
    store.net = emptyNet();
    flashError("房间已解散。");
  },
};

watch(
  () => store.toast,
  (v) => {
    if (toastTimer) window.clearTimeout(toastTimer);
    if (!v) return;
    toastTimer = window.setTimeout(() => {
      if (store.toast?.id === v.id) store.toast = null;
    }, 2600);
  },
);

onMounted(async () => {
  try {
    // 刷新页面后凭本地存下的房间号 + 座位票据自动回到原座位
    if (await session.resume()) session.start();
  } catch {
    /* 没有可续连的房间，正常走大厅 */
  }
});

onBeforeUnmount(() => {
  if (toastTimer) window.clearTimeout(toastTimer);
  if (statsTimer) window.clearInterval(statsTimer);
  if (errTimer) window.clearTimeout(errTimer);
  director.value?.stop();
  session.stop();
});
</script>

<style scoped>
.booting {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  background: #eef2f5;
}

.boot-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 26px;
}

.boot-card p {
  margin: 0;
  font-size: 13px;
  letter-spacing: 0.1em;
  color: var(--ink-2);
}

.spin {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2.5px solid rgba(31, 162, 184, 0.22);
  border-top-color: var(--primary);
  animation: rot 0.8s linear infinite;
}

@keyframes rot {
  to { transform: rotate(360deg); }
}
</style>
