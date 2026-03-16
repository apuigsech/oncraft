<script setup lang="ts">
defineProps<{
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}>();

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}
</script>

<template>
  <div class="session-metrics">
    <span v-if="costUsd > 0" class="metric" title="Session cost">
      ${{ costUsd.toFixed(4) }}
    </span>
    <span v-if="inputTokens + outputTokens > 0" class="metric" title="Tokens (in/out)">
      {{ formatTokens(inputTokens) }}↑ {{ formatTokens(outputTokens) }}↓
    </span>
    <span v-if="durationMs > 0" class="metric" title="API duration">
      {{ formatDuration(durationMs) }}
    </span>
  </div>
</template>

<style scoped>
.session-metrics {
  display: flex; align-items: center; gap: 10px;
  font-size: 10px; color: var(--text-muted); font-family: monospace;
  padding: 2px 0;
}
.metric { white-space: nowrap; }
</style>
