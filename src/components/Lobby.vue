<template>
  <div class="lobby">
    <div class="lobby-bg"></div>
    <div class="lobby-wrap">
      <section class="panel frost">
        <header class="brand">
          <div class="brand-mark">
            <span class="dot"></span>
            <span class="dot d2"></span>
            <span class="dot d3"></span>
          </div>
          <div>
            <h1>{{ BRAND.title }}</h1>
            <p class="brand-cn">{{ BRAND.titleCn }} · 3D 飞行棋</p>
          </div>
        </header>

        <div class="field row modetabs">
          <div class="seg">
            <button :class="{ on: mode === 'solo' }" @click="mode = 'solo'">🎮 单机对战</button>
            <button :class="{ on: mode === 'online' }" @click="mode = 'online'">🌐 联机开黑</button>
          </div>
          <div class="seg">
            <button :class="{ on: store.timeOfDay === 'day' }" @click="store.timeOfDay = 'day'">☀ 白天</button>
            <button :class="{ on: store.timeOfDay === 'night' }" @click="store.timeOfDay = 'night'">☾ 黑夜</button>
          </div>
        </div>

        <!-- ---------- 联机：已经在房间里 ---------- -->
        <template v-if="mode === 'online' && store.net.active">
          <div class="room">
            <div class="room-head">
              <span class="rl">房间号</span>
              <strong class="rcode">{{ store.net.code }}</strong>
              <button class="btn ghost small" @click="copyCode">{{ copied ? "已复制" : "复制" }}</button>
            </div>

            <ul class="seats">
              <li
                v-for="(s, i) in store.net.seats"
                :key="s.seat"
                :class="{ me: s.isMe, offline: !s.online }"
              >
                <i :style="{ background: colorOf(s.charId) }"></i>
                <b>{{ s.name }}</b>
                <em v-if="s.isHost" class="tag host">房主</em>
                <em v-if="!s.online" class="tag off">离线</em>
                <span class="pk">P{{ i + 1 }}</span>
              </li>
              <li v-for="i in emptySeats" :key="'e' + i" class="empty">
                <i></i><b>空位 · 开局由电脑补位</b>
              </li>
            </ul>

            <p class="note">
              把这个 5 位房间号发给朋友，让他们打开同一个网址、切到「联机开黑」填进来就能入座。
              最多 4 人；人不够的位置开局后由电脑顶上。
            </p>

            <div class="room-actions">
              <button v-if="store.net.isHost" class="start" @click="begin">
                <span>开始对局</span>
                <em>START RALLY</em>
              </button>
              <div v-else class="waiting">
                <span class="blink"></span>等待房主开始…
              </div>
              <button class="btn ghost" @click="leave">离开房间</button>
            </div>
          </div>
        </template>

        <!-- ---------- 单机 / 联机未入座：公共部分 ---------- -->
        <template v-else>
          <div class="field">
            <label>选择棋盘 <span class="sub">（点一下立刻换，背后的沙盘同步切换）</span></label>
            <div class="scenes">
              <button
                v-for="s in SCENE_LIST"
                :key="s.id"
                class="scard"
                :class="{ on: scene.id === s.id }"
                :title="s.tagline"
                @click="emit('scene', s.id)"
              >
                <span class="smark" :class="s.id"></span>
                <span class="stxt">
                  <strong>{{ s.label }}</strong>
                  <small>{{ s.sub }}</small>
                </span>
              </button>
            </div>
          </div>

          <div class="field">
            <label>你的名字</label>
            <input
              v-model="myName"
              maxlength="8"
              :placeholder="mode === 'online' ? '先起个名字，再建 / 加入房间' : '输入一个名字，开始发车'"
              @keyup.enter="mode === 'online' ? create() : start()"
            />
          </div>

          <div class="field">
            <label>
              选择角色
              <span class="sub">{{ mode === "online" ? "（进房后其他人也能看到）" : "（其余角色自动分配给对手）" }}</span>
            </label>
            <div class="chars">
              <button
                v-for="c in CHARACTERS"
                :key="c.id"
                class="char"
                :class="{ on: c.id === charId }"
                :style="{ '--c': c.color, '--cd': c.deep }"
                @click="charId = c.id"
              >
                <span class="pawn"></span>
                <strong>{{ c.name }}</strong>
                <em>{{ c.en }}</em>
                <small>{{ c.tagline }}</small>
              </button>
            </div>
          </div>

          <!-- 单机：对手设置 -->
          <div v-if="mode === 'solo'" class="field">
            <label>对手设置 <span class="sub">（共 {{ totalPlayers }} 位玩家）</span></label>
            <div class="slots">
              <div v-for="(s, i) in slots" :key="i" class="slot">
                <span class="slot-no">P{{ i + 2 }}</span>
                <div class="seg">
                  <button :class="{ on: s.mode === 'ai' }" @click="s.mode = 'ai'">电脑</button>
                  <button :class="{ on: s.mode === 'human' }" @click="s.mode = 'human'">玩家</button>
                  <button :class="{ on: s.mode === 'off' }" @click="s.mode = 'off'">关闭</button>
                </div>
                <input
                  v-if="s.mode === 'human'"
                  v-model="s.name"
                  maxlength="8"
                  class="mini"
                  placeholder="名字"
                />
                <span v-else class="slot-note">{{ s.mode === "ai" ? "自动对局" : "不参战" }}</span>
              </div>
            </div>
          </div>

          <!-- 联机：建房 / 加入 -->
          <div v-else class="field">
            <label>开房间 <span class="sub">（同一局的人打开同一个网址即可）</span></label>
            <div class="joinrow">
              <button class="big primary" :disabled="store.net.busy !== ''" @click="create">
                {{ store.net.busy === "create" ? "创建中…" : "创建房间" }}
              </button>
              <input
                v-model="joinCode"
                class="codeinput"
                maxlength="5"
                placeholder="房间号"
                @keyup.enter="join"
              />
              <button class="big" :disabled="store.net.busy !== ''" @click="join">
                {{ store.net.busy === "join" ? "加入中…" : "加入" }}
              </button>
            </div>
          </div>

          <button v-if="mode === 'solo'" class="start" @click="start">
            <span>开始游戏</span>
            <em>START RALLY</em>
          </button>
        </template>

        <p v-if="store.net.error" class="err">{{ store.net.error }}</p>
      </section>

      <aside class="side">
        <div class="card frost">
          <h3>怎么玩 · {{ scene.label }}</h3>
          <ol>
            <li v-for="(r, i) in scene.rules" :key="i">{{ r }}</li>
          </ol>
        </div>
        <div class="card frost">
          <h3>联机怎么开</h3>
          <ol>
            <li>切到<b>联机开黑</b>，起名字、选角色，点<b>创建房间</b>。</li>
            <li>把 5 位房间号发给朋友。</li>
            <li>朋友打开同一个网址 → 联机开黑 → 填房间号 → <b>加入</b>。</li>
            <li>房主点<b>开始对局</b>，所有人同时进同一张棋盘。</li>
            <li>中途掉线也没关系：刷新会自动回到原座位，长时间没人动由电脑代打。</li>
          </ol>
        </div>
        <div class="card frost">
          <h3>格子图例</h3>
          <div class="legend">
            <span v-for="k in legend" :key="k.kind" class="lg">
              <i :style="{ background: k.color }"></i>{{ k.label }}
            </span>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { BRAND, CHARACTERS, TILE_STYLE, TILE_KIND_LIST } from "../game/theme";
import { SCENE_LIST, activeScene as scene } from "../game/scenes";
import { store } from "../game/store";
import type { PlayerSetup } from "../game/types";

const emit = defineEmits<{
  (e: "start", cfg: { players: PlayerSetup[] }): void;
  (e: "create", name: string, charId: string): void;
  (e: "join", code: string, name: string, charId: string): void;
  (e: "seat", name: string, charId: string): void;
  (e: "begin"): void;
  (e: "leave"): void;
  (e: "scene", id: string): void;
}>();

const mode = ref<"solo" | "online">("solo");
const myName = ref("");
const charId = ref(CHARACTERS[0].id);
const joinCode = ref("");
const copied = ref(false);

const slots = reactive([
  { mode: "ai" as "ai" | "human" | "off", name: "" },
  { mode: "ai" as "ai" | "human" | "off", name: "" },
  { mode: "off" as "ai" | "human" | "off", name: "" },
]);

const totalPlayers = computed(() => 1 + slots.filter((s) => s.mode !== "off").length);
const emptySeats = computed(() => Math.max(0, 4 - store.net.seats.length));

const displayName = computed(() => (myName.value || "").trim() || "车手");

/** 图例跟着当前棋盘走：换一张盘，格型清单自己就变了 */
const legend = computed(() => {
  const used = new Set<string>(scene.value.ring.map((t) => t.kind));
  if (scene.value.climb > 0) used.add("home");
  return TILE_KIND_LIST.filter((k) => used.has(k)).map((k) => ({
    kind: k,
    label: TILE_STYLE[k].label,
    color: TILE_STYLE[k].color,
  }));
});

const colorOf = (id: string) => CHARACTERS.find((c) => c.id === id)?.color ?? "#8a97a3";

/** 入座后改名字 / 换角色，防抖同步到自己那一格 */
let seatTimer: number | null = null;
watch([myName, charId], () => {
  if (!store.net.active) return;
  if (seatTimer) window.clearTimeout(seatTimer);
  seatTimer = window.setTimeout(() => emit("seat", displayName.value, charId.value), 320);
});

watch(
  () => store.net.active,
  (v) => {
    if (v) mode.value = "online";
  },
);

function start() {
  const me = displayName.value;
  const others = CHARACTERS.filter((c) => c.id !== charId.value);
  const players: PlayerSetup[] = [{ id: 0, name: me, charId: charId.value, isAI: false }];
  let oi = 0;
  slots.forEach((s) => {
    if (s.mode === "off") return;
    const ch = others[oi % others.length];
    oi++;
    players.push({
      id: players.length,
      name: s.mode === "ai" ? `${ch.name} AI` : (s.name || "").trim() || `玩家${players.length + 1}`,
      charId: ch.id,
      isAI: s.mode === "ai",
    });
  });
  emit("start", { players });
}

function create() {
  emit("create", displayName.value, charId.value);
}

function join() {
  emit("join", joinCode.value, displayName.value, charId.value);
}

function begin() {
  emit("begin");
}

function leave() {
  emit("leave");
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(store.net.code);
    copied.value = true;
    window.setTimeout(() => (copied.value = false), 1400);
  } catch {
    copied.value = false;
  }
}
</script>

<style scoped>
.lobby {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
  padding: 28px;
}

.lobby-bg {
  position: absolute;
  inset: 0;
  background: radial-gradient(120% 90% at 18% 40%, rgba(238, 243, 246, 0.9), rgba(228, 236, 241, 0.55) 55%, rgba(226, 234, 240, 0.3));
  backdrop-filter: blur(2px);
}

.lobby-wrap {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 560px) minmax(0, 300px);
  gap: 18px;
  max-width: 940px;
  width: 100%;
  align-items: start;
}

.panel {
  padding: 26px 26px 22px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 13px;
  margin-bottom: 14px;
}

.brand-mark {
  width: 42px;
  height: 42px;
  border-radius: 13px;
  background: linear-gradient(150deg, #2bb6cb, #0e6e80);
  display: grid;
  place-items: center;
  position: relative;
  box-shadow: 0 8px 20px rgba(31, 162, 184, 0.32);
}

.dot {
  position: absolute;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #fff;
  left: 11px;
  top: 12px;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.25);
}
.dot.d2 { left: 23px; top: 12px; opacity: 0.8; }
.dot.d3 { left: 17px; top: 23px; opacity: 0.6; }

h1 {
  margin: 0;
  font-size: 22px;
  letter-spacing: 0.1em;
  font-weight: 900;
  color: var(--ink);
}

.brand-cn {
  margin: 2px 0 0;
  font-size: 12px;
  letter-spacing: 0.24em;
  color: var(--primary-deep);
  font-weight: 700;
}

.field {
  margin-bottom: 16px;
}

.field label {
  display: block;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--ink-2);
  margin-bottom: 8px;
}

.field .sub {
  font-weight: 500;
  color: var(--ink-3);
}

.field.row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.field.row label {
  margin: 0;
}

.modetabs {
  margin-bottom: 18px;
  gap: 8px;
}

input {
  width: 100%;
  padding: 11px 13px;
  border-radius: 11px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.9);
  font-size: 14px;
  color: var(--ink);
  outline: none;
  transition: border 0.18s, box-shadow 0.18s;
}

input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(31, 162, 184, 0.16);
}

.chars {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 9px;
}

.scenes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}

.scard {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 13px;
  border-radius: 13px;
  border: 1.5px solid var(--line);
  background: rgba(255, 255, 255, 0.7);
  text-align: left;
  transition: all 0.18s ease;
}

.scard:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-sm);
}

.scard.on {
  border-color: var(--primary);
  background: linear-gradient(180deg, rgba(31, 162, 184, 0.13), #fff);
  box-shadow: 0 8px 20px rgba(31, 162, 184, 0.22);
}

.stxt {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.scard strong {
  font-size: 13px;
}

.scard small {
  font-size: 9.5px;
  color: var(--ink-3);
  line-height: 1.35;
}

/* 两块棋盘的缩略图形：圆角方环（都会） vs 水面上的绿岛 */
.smark {
  position: relative;
  flex: 0 0 22px;
  width: 22px;
  height: 22px;
}

.smark.city {
  border: 3.5px solid var(--primary);
  border-radius: 9px;
}

/* 浮岛：一圈水 + 中间一块绿地 */
.smark.island {
  border-radius: 50%;
  background: linear-gradient(160deg, #4fd0dc, #2f9fbe);
  box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.5);
}

.smark.island::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 12px;
  height: 12px;
  transform: translate(-50%, -50%);
  border-radius: 52% 48% 46% 54%;
  background: #6fc04a;
}

.char {
  position: relative;
  padding: 12px 8px 10px;
  border-radius: 13px;
  border: 1.5px solid var(--line);
  background: rgba(255, 255, 255, 0.7);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  transition: all 0.18s ease;
}

.char:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-sm);
}

.char.on {
  border-color: var(--c);
  background: linear-gradient(180deg, color-mix(in srgb, var(--c) 14%, #fff), #fff);
  box-shadow: 0 8px 20px color-mix(in srgb, var(--c) 26%, transparent);
}

.pawn {
  width: 20px;
  height: 24px;
  border-radius: 50% 50% 34% 34% / 58% 58% 42% 42%;
  background: linear-gradient(160deg, color-mix(in srgb, var(--c) 72%, #fff), var(--cd));
  box-shadow: inset -2px -3px 6px rgba(0, 0, 0, 0.18), 0 3px 7px rgba(20, 30, 40, 0.18);
  margin-bottom: 3px;
}

.char strong {
  font-size: 13px;
}

.char em {
  font-size: 9.5px;
  letter-spacing: 0.14em;
  color: var(--ink-3);
  font-style: normal;
  font-weight: 700;
}

.char small {
  font-size: 9.5px;
  color: var(--ink-3);
  text-align: center;
  line-height: 1.35;
  margin-top: 2px;
}

.slots {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.slot {
  display: flex;
  align-items: center;
  gap: 10px;
}

.slot-no {
  width: 30px;
  font-size: 12px;
  font-weight: 800;
  color: var(--ink-3);
}

.slot-note {
  font-size: 11.5px;
  color: var(--ink-3);
}

.seg {
  display: inline-flex;
  padding: 3px;
  border-radius: 10px;
  background: rgba(34, 48, 60, 0.07);
  gap: 2px;
}

.seg button {
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
  transition: all 0.16s ease;
}

.seg button.on {
  background: #fff;
  color: var(--primary-deep);
  box-shadow: 0 2px 7px rgba(28, 44, 58, 0.12);
}

input.mini {
  width: 110px;
  padding: 6px 10px;
  font-size: 12px;
  border-radius: 9px;
}

/* ---- 联机：建房 / 加入 ---- */
.joinrow {
  display: flex;
  gap: 9px;
  align-items: stretch;
}

.big {
  flex: 1;
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
  background: rgba(255, 255, 255, 0.82);
  border: 1.5px solid var(--line);
  transition: all 0.18s ease;
}

.big:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}

.big:disabled {
  opacity: 0.55;
}

.big.primary {
  background: linear-gradient(135deg, #2bb6cb, #0e6e80 80%);
  color: #fff;
  border-color: transparent;
  box-shadow: 0 10px 24px rgba(31, 162, 184, 0.3);
}

.codeinput {
  flex: 0 0 118px;
  text-align: center;
  letter-spacing: 0.22em;
  font-weight: 800;
  text-transform: uppercase;
  font-size: 15px;
}

/* ---- 联机：房间面板 ---- */
.room {
  border: 1.5px solid var(--line);
  border-radius: 15px;
  padding: 15px 16px 14px;
  background: rgba(255, 255, 255, 0.56);
}

.room-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.rl {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--ink-3);
  letter-spacing: 0.08em;
}

.rcode {
  font-size: 26px;
  font-weight: 900;
  letter-spacing: 0.2em;
  color: var(--primary-deep);
  font-variant-numeric: tabular-nums;
  flex: 1;
}

.seats {
  list-style: none;
  margin: 0 0 11px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.seats li {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 11px;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid transparent;
  font-size: 13px;
}

.seats li.me {
  border-color: var(--primary);
  background: rgba(43, 182, 203, 0.1);
}

.seats li.offline {
  opacity: 0.55;
}

.seats li.empty {
  color: var(--ink-3);
  border: 1px dashed var(--line);
  background: transparent;
  font-size: 12px;
}

.seats li i {
  width: 11px;
  height: 11px;
  border-radius: 4px;
  background: #c8d2da;
  flex: 0 0 auto;
  box-shadow: 0 2px 5px rgba(28, 44, 58, 0.18);
}

.seats li b {
  flex: 1;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tag {
  font-style: normal;
  font-size: 10px;
  font-weight: 800;
  padding: 1px 6px;
  border-radius: 5px;
}

.tag.host { background: rgba(31, 162, 184, 0.16); color: var(--primary-deep); }
.tag.off { background: rgba(226, 84, 63, 0.14); color: #c2412c; }

.pk {
  font-size: 10.5px;
  font-weight: 800;
  color: var(--ink-3);
  letter-spacing: 0.08em;
}

.note {
  margin: 0 0 13px;
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--ink-3);
}

.room-actions {
  display: flex;
  gap: 9px;
  align-items: stretch;
}

.room-actions .start {
  flex: 1;
  margin-top: 0;
}

.waiting {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.7);
  border: 1.5px dashed var(--line);
  font-size: 13px;
  font-weight: 700;
  color: var(--ink-2);
}

.blink {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--primary);
  animation: blink 1.3s ease-in-out infinite;
}

@keyframes blink {
  0%, 100% { opacity: 0.25; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1); }
}

.err {
  margin: 12px 0 0;
  font-size: 12px;
  color: #c2412c;
  background: rgba(226, 84, 63, 0.1);
  border-radius: 10px;
  padding: 8px 12px;
}

.start {
  width: 100%;
  margin-top: 6px;
  padding: 15px;
  border-radius: 14px;
  background: linear-gradient(135deg, #2bb6cb, #0e6e80 70%);
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  box-shadow: 0 14px 32px rgba(31, 162, 184, 0.36);
  transition: transform 0.16s ease, box-shadow 0.16s ease;
}

.start span {
  font-size: 17px;
  font-weight: 800;
  letter-spacing: 0.1em;
}

.start em {
  font-style: normal;
  font-size: 10px;
  letter-spacing: 0.3em;
  opacity: 0.75;
}

.start:hover {
  transform: translateY(-2px);
  box-shadow: 0 18px 38px rgba(31, 162, 184, 0.44);
}

.side {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.card {
  padding: 18px 18px 16px;
}

.card h3 {
  margin: 0 0 10px;
  font-size: 13px;
  letter-spacing: 0.08em;
  color: var(--primary-deep);
}

.card ol {
  margin: 0;
  padding-left: 17px;
  font-size: 11.8px;
  line-height: 1.85;
  color: var(--ink-2);
}

.card ol b {
  color: var(--ink);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
}

.lg {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  color: var(--ink-2);
}

.lg i {
  width: 12px;
  height: 12px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 1px 3px rgba(28, 44, 58, 0.2);
}

@media (max-width: 900px) {
  .lobby-wrap {
    grid-template-columns: minmax(0, 1fr);
  }
  .side {
    display: none;
  }
}
</style>
