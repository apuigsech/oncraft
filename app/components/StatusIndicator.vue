<script setup lang="ts">
import type { CardState } from '~/types';

const props = withDefaults(defineProps<{
  state: CardState;
  size?: 'sm' | 'md';
}>(), { size: 'md' });

const sizeMap = { sm: 8, md: 12 };
const px = computed(() => sizeMap[props.size]);
</script>

<template>
  <span
    class="status-indicator"
    :class="[`status-indicator--${props.state}`, `status-indicator--${props.size}`]"
    :title="props.state"
  >
    <!-- Active: filled circle + expanding pulse ring -->
    <template v-if="props.state === 'active'">
      <span class="status-dot status-dot--active" :style="{ width: px + 'px', height: px + 'px' }" />
      <span class="status-ring" :style="{ width: px + 'px', height: px + 'px' }" />
    </template>

    <!-- Idle: outline-only circle -->
    <template v-else-if="props.state === 'idle'">
      <span class="status-dot status-dot--idle" :style="{ width: px + 'px', height: px + 'px' }" />
    </template>

    <!-- Error: solid red circle -->
    <template v-else-if="props.state === 'error'">
      <span class="status-dot status-dot--error" :style="{ width: px + 'px', height: px + 'px' }" />
    </template>

    <!-- Completed: green checkmark -->
    <template v-else-if="props.state === 'completed'">
      <svg
        class="status-check"
        :width="px" :height="px"
        viewBox="0 0 12 12"
        fill="none"
        stroke="var(--success)"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="2.5 6 5 8.5 9.5 3.5" />
      </svg>
    </template>
  </span>
</template>

<style scoped>
.status-indicator {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.status-indicator--md { width: 12px; height: 12px; }
.status-indicator--sm { width: 8px; height: 8px; }

.status-dot {
  display: block;
  border-radius: 50%;
}

/* Active: green filled + animated ring */
.status-dot--active {
  background: var(--success);
  box-shadow: 0 0 0 1px rgba(74, 222, 128, 0.3);
}
.status-ring {
  position: absolute;
  top: 0;
  left: 0;
  border-radius: 50%;
  border: 1.5px solid var(--success);
  animation: pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  pointer-events: none;
}
@keyframes pulse-ring {
  0% {
    transform: scale(1);
    opacity: 0.8;
  }
  70% {
    transform: scale(2.2);
    opacity: 0;
  }
  100% {
    transform: scale(2.2);
    opacity: 0;
  }
}

/* Idle: gray outline only */
.status-dot--idle {
  background: transparent;
  border: 1.5px solid var(--text-muted);
}

/* Error: red filled */
.status-dot--error {
  background: var(--error);
  box-shadow: 0 0 0 1px rgba(248, 113, 113, 0.3);
}

/* Completed: checkmark styled via inline SVG */
.status-check {
  display: block;
}
</style>
