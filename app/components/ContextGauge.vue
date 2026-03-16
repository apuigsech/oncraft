<script setup lang="ts">

const props = defineProps<{
  inputTokens: number;
  outputTokens: number;
  maxTokens?: number;
}>();

const max = computed(() => props.maxTokens || 200000);
const total = computed(() => props.inputTokens + props.outputTokens);
const percent = computed(() => Math.min(100, (total.value / max.value) * 100));
const color = computed(() => {
  if (percent.value < 50) return 'var(--success)';
  if (percent.value < 80) return 'var(--warning)';
  return 'var(--error)';
});
</script>

<template>
  <div class="context-gauge" :title="`Context: ${total.toLocaleString()} / ${max.toLocaleString()} tokens (${Math.round(percent)}%)`">
    <div class="gauge-track">
      <div class="gauge-fill" :style="{ width: percent + '%', background: color }" />
    </div>
    <span class="gauge-label">{{ Math.round(percent) }}%</span>
  </div>
</template>

<style scoped>
.context-gauge { display: flex; align-items: center; gap: 4px; }
.gauge-track {
  width: 48px; height: 4px; background: var(--bg-tertiary);
  border-radius: 2px; overflow: hidden;
}
.gauge-fill { height: 100%; border-radius: 2px; transition: width 0.3s, background 0.3s; }
.gauge-label { font-size: 10px; color: var(--text-muted); font-family: monospace; min-width: 24px; }
</style>
