<template>
  <div class="result">
    <div class="rbg"></div>
    <div class="card frost">
      <div class="crown">🏁</div>
      <p class="eyebrow">RACE COMPLETE</p>
      <h2 v-if="store.winner">
        <span class="hl" :style="{ color: store.winner.color }">{{ store.winner.name }}</span>
        {{ scene.winTitle }}
      </h2>
      <p class="sub">
        完成了 {{ scene.lap }} 格竞速 · 共 {{ store.round }} 回合 ·
        {{ store.stats.fps }} FPS / {{ store.stats.drawCalls }} draw calls
      </p>

      <ul class="rank">
        <li v-for="(p, i) in store.standings" :key="p.id" :style="{ '--c': p.color, '--cd': p.deep }">
          <span class="no">{{ i + 1 }}</span>
          <span class="dot"></span>
          <strong>{{ p.name }}</strong>
          <em>{{ charName(p.charId) }}{{ p.isAI ? " · AI" : "" }}</em>
          <span class="pos">
            <template v-if="p.finished">{{ scene.winWord }}</template>
            <template v-else>{{ p.pos }} / {{ scene.lap }}</template>
          </span>
        </li>
      </ul>

      <div class="actions">
        <button class="btn primary" @click="$emit('again')">再来一局</button>
        <button class="btn ghost" @click="$emit('lobby')">返回大厅</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { store } from "../game/store";
import { CHARACTERS } from "../game/theme";
import { activeScene as scene } from "../game/scenes";

defineEmits<{ (e: "again"): void; (e: "lobby"): void }>();
const charName = (id: string) => CHARACTERS.find((c) => c.id === id)?.name ?? "";
</script>

<style scoped>
.result {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 24px;
}

.rbg {
  position: absolute;
  inset: 0;
  background: radial-gradient(70% 60% at 50% 40%, rgba(240, 246, 249, 0.82), rgba(226, 236, 242, 0.6));
  backdrop-filter: blur(6px);
}

.card {
  position: relative;
  width: min(460px, 100%);
  padding: 30px 28px 24px;
  text-align: center;
  animation: rise 0.5s cubic-bezier(0.22, 1.2, 0.36, 1);
}

@keyframes rise {
  from { transform: translateY(20px) scale(0.96); opacity: 0; }
  to { transform: translateY(0) scale(1); opacity: 1; }
}

.crown {
  font-size: 40px;
  line-height: 1;
  margin-bottom: 8px;
  animation: bob 1.8s ease-in-out infinite;
}

@keyframes bob {
  0%, 100% { transform: translateY(0) rotate(-4deg); }
  50% { transform: translateY(-7px) rotate(4deg); }
}

.eyebrow {
  margin: 0;
  font-size: 10px;
  letter-spacing: 0.34em;
  font-weight: 800;
  color: var(--ink-3);
}

h2 {
  margin: 6px 0 6px;
  font-size: 24px;
  letter-spacing: 0.03em;
}

.hl {
  font-weight: 900;
}

.sub {
  margin: 0 0 18px;
  font-size: 12px;
  color: var(--ink-3);
  line-height: 1.7;
}

.rank {
  margin: 0 0 20px;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.rank li {
  display: grid;
  grid-template-columns: 22px 10px 1fr auto auto;
  align-items: center;
  gap: 9px;
  padding: 9px 12px;
  border-radius: 11px;
  background: color-mix(in srgb, var(--c) 9%, #fff);
  border: 1px solid color-mix(in srgb, var(--c) 22%, transparent);
  text-align: left;
}

.rank .no {
  font-size: 12px;
  font-weight: 800;
  color: var(--ink-3);
}

.rank .dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: linear-gradient(150deg, color-mix(in srgb, var(--c) 70%, #fff), var(--cd));
}

.rank strong {
  font-size: 13.5px;
}

.rank em {
  font-style: normal;
  font-size: 11px;
  color: var(--ink-3);
}

.rank .pos {
  font-size: 12px;
  font-weight: 700;
  color: var(--cd);
  font-variant-numeric: tabular-nums;
}

.actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}
</style>
