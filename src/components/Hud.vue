<template>
  <div class="hud">
    <!-- 玩家面板 -->
    <div class="players">
      <div
        v-for="(p, i) in store.players"
        :key="p.id"
        class="pcard frost"
        :class="{ active: i === store.current && !p.finished, done: p.finished }"
        :style="{ '--c': p.color, '--cd': p.deep }"
      >
        <span class="pbar" :style="{ width: progress(p) + '%' }"></span>
        <div class="prow">
          <span class="pdot"></span>
          <strong>{{ p.name }}</strong>
          <em v-if="p.isAI">AI</em>
          <span class="ppos">{{ p.pos }}<small>/{{ scene.lap }}</small></span>
        </div>
        <div class="pmeta">
          <span class="chip tiny">{{ charName(p.charId) }}</span>
          <span v-if="p.shield > 0" class="chip tiny shield">护盾 ×{{ p.shield }}</span>
          <span v-if="p.freeze > 0" class="chip tiny ice">冻结 {{ p.freeze }}</span>
          <span v-if="p.finished" class="chip tiny win">第 {{ p.rank }} 名</span>
          <span v-else-if="i === store.current" class="chip tiny turn">行动中</span>
          <span v-if="store.net.aiTakeover.includes(i)" class="chip tiny ai">托管</span>
        </div>
      </div>
    </div>

    <!-- 房间状态（仅联机局） -->
    <div v-if="store.net.active" class="netbar frost">
      <span class="rdot" :class="{ live: store.net.online }"></span>
      <span class="rlab">房间</span>
      <b class="rcode">{{ store.net.code }}</b>
      <i></i>
      <span :class="{ warn: !store.net.online }">{{ store.net.online ? "已同步" : "重连中…" }}</span>
      <i></i>
      <span>{{ store.net.isHost ? "我建房" : "P" + (store.net.seatIndex + 1) }}</span>
    </div>

    <!-- 中央提示 -->
    <transition name="fade">
      <div v-if="store.toast" :key="store.toast.id" class="toast frost" :class="store.toast.tone">
        <span class="tico">{{ glyph(store.toast.icon) }}</span>
        <div>
          <strong>{{ store.toast.title }}</strong>
          <p>{{ store.toast.desc }}</p>
        </div>
      </div>
    </transition>

    <!-- 设置入口：右上角只留一个图标，具体操作都收进弹窗 -->
    <button class="setbtn frost" :class="{ open: settings }" title="设置" aria-label="设置" @click="settings = true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path
          d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.39a2 2 0 0 0 .73 2.73l.15.08a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
        />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </button>

    <!-- 设置弹窗 -->
    <transition name="fade">
      <div v-if="settings" class="mask" @click.self="settings = false">
        <div class="sheet frost" role="dialog" aria-label="对局设置">
          <header class="shead">
            <div>
              <h3>对局设置</h3>
              <p>棋盘 · 时段 · 镜头 · 节奏</p>
            </div>
            <button class="close" aria-label="关闭" @click="settings = false">✕</button>
          </header>

          <div class="sgroup">
            <span class="slab">棋盘</span>
            <div class="srow">
              <button
                v-for="s in SCENE_LIST"
                :key="s.id"
                class="btn ghost small"
                :class="{ 'is-on': scene.id === s.id }"
                :title="`${s.sub}（换棋盘会重开对局）`"
                @click="switchScene(s.id)"
              >
                {{ s.label }}
              </button>
            </div>
            <p class="snote">{{ scene.sub }} · 换棋盘会重开对局</p>
          </div>

          <div class="sgroup">
            <span class="slab">时段</span>
            <div class="srow">
              <button class="btn ghost small" :class="{ 'is-on': store.timeOfDay === 'day' }" @click="$emit('time', 'day')">
                ☀ 白天
              </button>
              <button class="btn ghost small" :class="{ 'is-on': store.timeOfDay === 'night' }" @click="$emit('time', 'night')">
                ☾ 黑夜
              </button>
            </div>
          </div>

          <div class="sgroup">
            <span class="slab">镜头</span>
            <div class="srow">
              <button class="btn ghost small" :class="{ 'is-on': view === 0 }" @click="$emit('view', 0)">全景</button>
              <button class="btn ghost small" :class="{ 'is-on': view === 1 }" @click="$emit('view', 1)">俯瞰</button>
              <button class="btn ghost small" :class="{ 'is-on': view === 2 }" @click="$emit('view', 2)">平视</button>
              <button class="btn ghost small" :class="{ 'is-on': autoRotate }" @click="$emit('autorotate', !autoRotate)">
                环绕
              </button>
            </div>
          </div>

          <div class="sgroup">
            <span class="slab">节奏</span>
            <div class="srow">
              <button class="btn ghost small" :class="{ 'is-on': store.speed === 1 }" @click="$emit('speed', 1)">1×</button>
              <button class="btn ghost small" :class="{ 'is-on': store.speed === 2 }" @click="$emit('speed', 2)">2× 快放</button>
              <button class="btn ghost small" :class="{ 'is-on': store.sound }" @click="$emit('sound', !store.sound)">
                {{ store.sound ? "🔊 音效开" : "🔇 音效关" }}
              </button>
            </div>
          </div>

          <footer class="sfoot">
            <span v-if="store.net.active" class="snet">
              房间 <b>{{ store.net.code }}</b> · {{ store.net.online ? "已同步" : "重连中" }}
            </span>
            <span v-else class="snet">单机对局 · 第 {{ store.round }} 回合</span>
            <button class="btn ghost small danger" @click="restart">重开对局</button>
          </footer>
        </div>
      </div>
    </transition>

    <!-- 读数 -->
    <div class="stats frost">
      <span><b>{{ store.stats.fps }}</b> FPS</span>
      <i></i>
      <span><b>{{ store.stats.drawCalls }}</b> draw</span>
      <i></i>
      <span><b>{{ (store.stats.triangles / 1000).toFixed(0) }}k</b> tri</span>
      <i></i>
      <span>DPR <b>{{ store.stats.pixelRatio.toFixed(2) }}</b></span>
      <i></i>
      <span>第 <b>{{ store.round }}</b> 回合</span>
    </div>

    <!-- 事件流 -->
    <div class="log frost">
      <div class="log-h">城市播报</div>
      <ul>
        <li v-for="l in store.log.slice(0, 5)" :key="l.id" :class="l.tone">
          <span class="ldot" :style="{ background: colorOf(l.player) }"></span>
          <b>{{ l.title }}</b>
          <em>{{ l.desc }}</em>
        </li>
      </ul>
    </div>

    <!-- 骰子面板 -->
    <div class="dicezone">
      <transition name="fade">
        <div v-if="store.hint" class="hint">{{ store.hint }}</div>
      </transition>
      <button
        class="dicebtn"
        :class="{ ready: store.canRoll, rolling: store.rolling }"
        :disabled="!store.canRoll"
        @click="$emit('roll')"
      >
        <span class="diceface">
          <i v-for="(pip, i) in pips(store.diceValue)" :key="i" :style="pip"></i>
        </span>
        <span class="dlabel">
          <b>{{ store.canRoll ? "掷骰子" : store.rolling ? "投掷中" : "等待中" }}</b>
          <em>{{ currentName }}</em>
        </span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { store } from "../game/store";
import { CHARACTERS, TILE_STYLE } from "../game/theme";
import { SCENE_LIST, activeScene as scene } from "../game/scenes";
import type { PlayerState } from "../game/types";

defineProps<{ view: number; autoRotate: boolean }>();
const emit = defineEmits<{
  (e: "roll"): void;
  (e: "time", v: "day" | "night"): void;
  (e: "view", v: number): void;
  (e: "autorotate", v: boolean): void;
  (e: "speed", v: number): void;
  (e: "sound", v: boolean): void;
  (e: "restart"): void;
  (e: "scene", id: string): void;
}>();

/** 设置弹窗开关（纯前端状态，不影响对局） */
const settings = ref(false);
/** 重开是破坏性操作，点完顺手把弹窗收起来 */
const restart = () => {
  emit("restart");
  settings.value = false;
};

/** 换棋盘必须重开：棋子的落位、整局剧本都是照着棋盘几何算出来的 */
const switchScene = (id: string) => {
  if (scene.value.id === id) return;
  emit("scene", id);
  emit("restart");
  settings.value = false;
};

const currentName = computed(() => store.players[store.current]?.name ?? "");
const progress = (p: PlayerState) => Math.min(100, (p.pos / scene.value.lap) * 100);
const charName = (id: string) => CHARACTERS.find((c) => c.id === id)?.name ?? "";
const colorOf = (id: number) => store.players.find((p) => p.id === id)?.color ?? "#8a97a3";

const GLYPH: Record<string, string> = {
  arrow: "➤",
  star: "★",
  bolt: "⚡",
  gift: "🎁",
  question: "?",
  cone: "▲",
  snow: "❄",
  swap: "⇄",
  shield: "⛨",
  rocket: "➤",
  dice: "🎲",
  flag: "⚑",
};
const glyph = (icon: string) => GLYPH[icon] ?? TILE_STYLE.plain.icon;

/** 骰子点阵 */
function pips(v: number): Record<string, string>[] {
  const layouts: Record<number, [number, number][]> = {
    1: [[1, 1]],
    2: [[0, 0], [2, 2]],
    3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [2, 0], [0, 2], [2, 2]],
    5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
    6: [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]],
  };
  const cells = layouts[Math.max(1, Math.min(6, v))] ?? layouts[1];
  return cells.map(([cx, cy]) => ({
    left: `${12 + cx * 28}%`,
    top: `${12 + cy * 28}%`,
  }));
}
</script>

<style scoped>
.hud {
  position: fixed;
  inset: 0;
  z-index: 10;
  pointer-events: none;
}

.hud > * {
  pointer-events: auto;
}

/* ---- 玩家面板 ---- */
.players {
  position: absolute;
  top: 16px;
  left: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 232px;
}

.pcard {
  position: relative;
  padding: 9px 12px 10px;
  overflow: hidden;
  transition: transform 0.24s ease, box-shadow 0.24s ease, opacity 0.24s;
  opacity: 0.78;
}

.pcard.active {
  transform: translateX(6px);
  opacity: 1;
  box-shadow: 0 14px 34px color-mix(in srgb, var(--c) 30%, transparent), var(--shadow-lg);
  border-color: color-mix(in srgb, var(--c) 55%, #fff);
}

.pcard.done {
  opacity: 0.6;
}

.pbar {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--c), var(--cd));
  transition: width 0.5s cubic-bezier(0.22, 1, 0.36, 1);
}

.prow {
  display: flex;
  align-items: center;
  gap: 7px;
}

.pdot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: linear-gradient(150deg, color-mix(in srgb, var(--c) 70%, #fff), var(--cd));
  box-shadow: 0 2px 6px color-mix(in srgb, var(--c) 45%, transparent);
}

.prow strong {
  font-size: 13px;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.prow em {
  font-style: normal;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--ink-3);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 1px 4px;
}

.ppos {
  font-size: 15px;
  font-weight: 800;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

.ppos small {
  font-size: 9.5px;
  color: var(--ink-3);
  font-weight: 600;
}

.pmeta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
  min-height: 18px;
}

.chip.tiny {
  padding: 2px 7px;
  font-size: 10px;
}

.chip.shield { background: rgba(95, 208, 168, 0.2); color: #1c8a67; }
.chip.ice { background: rgba(111, 195, 232, 0.22); color: #1a7ba8; }
.chip.win { background: rgba(47, 174, 122, 0.2); color: #17754f; }
.chip.turn { background: color-mix(in srgb, var(--c) 22%, #fff); color: var(--cd); }
.chip.ai { background: rgba(155, 123, 240, 0.2); color: #5b3fb0; }

/* ---- 房间状态 ---- */
.netbar {
  position: absolute;
  top: 16px;
  left: 264px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 13px;
  font-size: 11px;
  color: var(--ink-3);
}

.netbar .rlab {
  letter-spacing: 0.06em;
}

.netbar .rcode {
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.16em;
  color: var(--primary-deep);
  font-variant-numeric: tabular-nums;
}

.netbar i {
  width: 1px;
  height: 11px;
  background: var(--line);
}

.netbar .warn {
  color: #c2412c;
  font-weight: 700;
}

.rdot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e2543f;
  box-shadow: 0 0 0 3px rgba(226, 84, 63, 0.16);
}

.rdot.live {
  background: #2fae7a;
  box-shadow: 0 0 0 3px rgba(47, 174, 122, 0.18);
}

/* ---- 提示 ---- */
.toast {
  position: absolute;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 20px 11px 14px;
  max-width: 460px;
}

.toast .tico {
  width: 36px;
  height: 36px;
  border-radius: 11px;
  display: grid;
  place-items: center;
  font-size: 17px;
  background: rgba(34, 48, 60, 0.07);
  color: var(--ink-2);
}

.toast strong {
  display: block;
  font-size: 14px;
  letter-spacing: 0.03em;
}

.toast p {
  margin: 1px 0 0;
  font-size: 12px;
  color: var(--ink-3);
}

.toast.good { border-color: rgba(47, 174, 122, 0.4); }
.toast.good .tico { background: rgba(47, 174, 122, 0.16); color: #1d8a5c; }
.toast.bad { border-color: rgba(226, 84, 63, 0.4); }
.toast.bad .tico { background: rgba(226, 84, 63, 0.16); color: #c2412c; }

/* ---- 设置入口 ---- */
.setbtn {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 13px;
  color: var(--ink-2);
  transition: transform 0.2s cubic-bezier(0.22, 1.2, 0.36, 1), box-shadow 0.24s, color 0.2s;
}

.setbtn:hover {
  color: var(--primary-deep);
  box-shadow: var(--shadow-lg);
}

.setbtn.open {
  color: var(--primary-deep);
  background: rgba(255, 255, 255, 0.94);
}

.setbtn svg {
  width: 21px;
  height: 21px;
}

.setbtn svg circle,
.setbtn svg path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* ---- 设置弹窗 ---- */
.mask {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  background: rgba(24, 38, 50, 0.34);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}

.sheet {
  width: min(430px, calc(100vw - 32px));
  padding: 18px 20px 16px;
  background: rgba(255, 255, 255, 0.94);
  animation: sheetIn 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes sheetIn {
  from { opacity: 0; transform: translateY(10px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.shead {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 13px;
  margin-bottom: 5px;
  border-bottom: 1px solid var(--line);
}

.shead h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.shead p {
  margin: 3px 0 0;
  font-size: 11.5px;
  letter-spacing: 0.1em;
  color: var(--ink-3);
}

.close {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: rgba(34, 48, 60, 0.04);
  color: var(--ink-2);
  font-size: 13px;
  transition: background 0.18s, color 0.18s;
}

.close:hover {
  background: rgba(226, 84, 63, 0.14);
  color: #c2412c;
}

.sgroup {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 10px 0;
}

.sgroup + .sgroup {
  border-top: 1px dashed var(--line);
}

.slab {
  flex: 0 0 40px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.16em;
  color: var(--ink-3);
}

.srow {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.snote {
  flex: 1 1 100%;
  margin: 0;
  padding-left: 52px;
  font-size: 11px;
  color: var(--ink-3);
  letter-spacing: 0.03em;
}

.btn.small {
  padding: 7px 12px;
  font-size: 12px;
  border-radius: 9px;
}

.sfoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 13px;
  margin-top: 4px;
  border-top: 1px solid var(--line);
}

.snet {
  font-size: 11.5px;
  color: var(--ink-3);
}

.snet b {
  color: var(--primary-deep);
  font-weight: 900;
  letter-spacing: 0.14em;
  font-variant-numeric: tabular-nums;
}

.btn.danger {
  color: #c2412c;
  border-color: rgba(226, 84, 63, 0.34);
}

.btn.danger:hover {
  background: rgba(226, 84, 63, 0.12);
}

/* ---- 读数 ---- */
.stats {
  position: absolute;
  top: 54px;
  left: 264px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 14px;
  font-size: 11px;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}

.stats b {
  color: var(--ink);
  font-weight: 800;
}

.stats i {
  width: 1px;
  height: 11px;
  background: var(--line);
}

/* ---- 日志 ---- */
.log {
  position: absolute;
  left: 16px;
  bottom: 16px;
  width: 306px;
  padding: 10px 13px 11px;
}

.log-h {
  font-size: 10.5px;
  letter-spacing: 0.22em;
  font-weight: 800;
  color: var(--primary-deep);
  margin-bottom: 6px;
}

.log ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.log li {
  display: grid;
  grid-template-columns: 8px auto 1fr;
  gap: 6px;
  align-items: baseline;
  font-size: 11px;
  line-height: 1.5;
  color: var(--ink-3);
  animation: slideIn 0.3s ease;
}

@keyframes slideIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.log li b {
  color: var(--ink-2);
  font-weight: 700;
  white-space: nowrap;
}

.log li em {
  font-style: normal;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log li.good b { color: #1d8a5c; }
.log li.bad b { color: #c2412c; }

.ldot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  transform: translateY(-2px);
}

/* ---- 骰子 ---- */
.dicezone {
  position: absolute;
  right: 30px;
  bottom: 26px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
}

.hint {
  font-size: 12px;
  font-weight: 700;
  color: var(--primary-deep);
  background: rgba(255, 255, 255, 0.86);
  padding: 6px 13px;
  border-radius: 999px;
  box-shadow: var(--shadow-sm);
  animation: pulseHint 1.8s ease-in-out infinite;
}

@keyframes pulseHint {
  0%, 100% { transform: translateY(0); opacity: 0.9; }
  50% { transform: translateY(-3px); opacity: 1; }
}

.dicebtn {
  position: relative;
  display: flex;
  align-items: center;
  gap: 15px;
  padding: 14px 24px 14px 16px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.5);
  border: 1.5px solid rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(20px) saturate(1.3);
  -webkit-backdrop-filter: blur(20px) saturate(1.3);
  box-shadow: var(--shadow-lg);
  transition: transform 0.2s cubic-bezier(0.22, 1.2, 0.36, 1), box-shadow 0.24s, opacity 0.24s;
  opacity: 0.55;
}

.dicebtn.ready {
  opacity: 1;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(238, 248, 251, 0.94));
  border-color: var(--primary);
  box-shadow: 0 16px 38px rgba(31, 162, 184, 0.36);
  animation: dicePulse 2.1s ease-in-out infinite;
}

@keyframes dicePulse {
  0%, 100% { box-shadow: 0 16px 38px rgba(31, 162, 184, 0.3); }
  50% { box-shadow: 0 16px 46px rgba(31, 162, 184, 0.55); }
}

.dicebtn.ready:hover {
  transform: translateY(-3px) scale(1.02);
}

.dicebtn.rolling .diceface {
  animation: spinBox 0.5s linear infinite;
}

@keyframes spinBox {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.diceface {
  position: relative;
  width: 58px;
  height: 58px;
  border-radius: 13px;
  background: linear-gradient(160deg, #ffffff, #e6eef2);
  box-shadow: inset -3px -4px 8px rgba(120, 140, 155, 0.28), 0 6px 14px rgba(28, 44, 58, 0.24);
}

.diceface i {
  position: absolute;
  width: 13%;
  height: 13%;
  border-radius: 50%;
  background: #2b3642;
  transform: translate(-50%, -50%);
}

.dlabel {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.dlabel b {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.06em;
}

.dlabel em {
  font-style: normal;
  font-size: 11px;
  color: var(--ink-3);
}

@media (max-width: 900px) {
  .players { width: 176px; }
  .stats { display: none; }
  .log { display: none; }
  .dicezone { right: 14px; bottom: 14px; }
  .dicebtn { padding: 10px 16px 10px 12px; gap: 10px; }
  .diceface { width: 44px; height: 44px; }
}
</style>
