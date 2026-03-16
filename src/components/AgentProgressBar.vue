<script setup lang="ts">
import { computed } from 'vue';
import type { AgentProgressEvent } from '../types';

const props = defineProps<{
  events: AgentProgressEvent[];
  isActive: boolean;
}>();

// The most recent event is the "current" status
const latest = computed(() => props.events[props.events.length - 1] ?? null);

const subtypeIcon: Record<string, string> = {
  task_started:      '▶',
  task_progress:     '◈',
  task_notification: '◎',
  status:            '◌',
};

const icon = computed(() => subtypeIcon[latest.value?.subtype ?? ''] ?? '◌');

// Visible only while the agent is active and there is at least one event
const visible = computed(() => props.isActive && !!latest.value);
</script>

<template>
  <Transition name="progress-fade">
    <div v-if="visible" class="agent-progress">
      <span class="progress-spinner" />
      <span class="progress-icon">{{ icon }}</span>
      <span class="progress-text">{{ latest!.content }}</span>
    </div>
  </Transition>
</template>

<style scoped>
.agent-progress {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  margin: 2px 0;
  background: var(--bg-secondary);
  border: 1px solid var(--bg-tertiary);
  border-radius: 6px;
  font-size: 11px;
  color: var(--text-muted);
  font-family: 'SF Mono', 'Fira Code', monospace;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* Pulsing spinner dot */
.progress-spinner {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.4; transform: scale(0.7); }
}

.progress-icon {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--accent);
}

.progress-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

/* Fade transition */
.progress-fade-enter-active,
.progress-fade-leave-active { transition: opacity 0.25s, transform 0.25s; }
.progress-fade-enter-from,
.progress-fade-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
