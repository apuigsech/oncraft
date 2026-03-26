<script setup lang="ts">
import type { ChatPart } from '~/types';

const props = defineProps<{
  parts: ChatPart[];
  isActive: boolean;
  cardId: string;
}>();

const sessionsStore = useSessionsStore();

const subAgentCount = computed(() => sessionsStore.getActiveSubAgentCount(props.cardId));

const latest = computed(() => {
  const p = props.parts[props.parts.length - 1];
  if (!p) return null;
  return {
    subtype: p.kind,
    content: (p.data.description as string) || (p.data.content as string) || (p.data.status as string) || p.kind,
  };
});

const subtypeIcon: Record<string, string> = {
  task_started:      '▶',
  task_progress:     '◈',
  task_notification: '◎',
  status:            '◌',
  tool_progress:     '⚙',
};

const icon = computed(() => subtypeIcon[latest.value?.subtype ?? ''] ?? '◌');

// Always visible when agent is active — provides persistent activity feedback
const visible = computed(() => props.isActive);

const statusText = computed(() => {
  if (latest.value?.content) return latest.value.content;
  return 'Working...';
});
</script>

<template>
  <Transition name="progress-fade">
    <div v-if="visible" class="agent-progress">
      <span class="progress-spinner" />
      <span v-if="latest" class="progress-icon">{{ icon }}</span>
      <span class="progress-text">{{ statusText }}</span>
      <span v-if="subAgentCount > 0" class="sub-agent-badge">
        {{ subAgentCount }} sub-agent{{ subAgentCount > 1 ? 's' : '' }}
      </span>
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
.progress-icon { flex-shrink: 0; font-size: 10px; color: var(--accent); }
.progress-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.sub-agent-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--bg-primary);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.progress-fade-enter-active,
.progress-fade-leave-active { transition: opacity 0.25s, transform 0.25s; }
.progress-fade-enter-from,
.progress-fade-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
