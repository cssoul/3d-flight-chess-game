<template>
  <div ref="host" class="canvas-host"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { SceneManager } from "../three/SceneManager";
import { store } from "../game/store";

const emit = defineEmits<{ (e: "ready", scene: unknown): void }>();
const host = ref<HTMLDivElement | null>(null);
let scene: SceneManager | null = null;

onMounted(() => {
  if (!host.value) return;
  scene = new SceneManager(host.value, store.timeOfDay);
  emit("ready", scene);
});

onBeforeUnmount(() => {
  scene?.dispose();
  scene = null;
});
</script>
