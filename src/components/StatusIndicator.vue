<script setup lang="ts">
import type { CardState } from '../types';

const props = defineProps<{ state: CardState }>();

const colorMap: Record<CardState, string> = {
  active:    'var(--success)',
  idle:      'var(--text-muted)',
  error:     'var(--error)',
  completed: 'transparent',
};
</script>

<template>
  <span
    class="status-dot"
    :class="{ pulse: props.state === 'active' }"
    :style="{ backgroundColor: colorMap[props.state] }"
    :title="props.state"
  />
</template>

<style scoped>
.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 1px solid rgba(255,255,255,0.15);
}
.pulse {
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}
</style>
