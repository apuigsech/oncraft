<script setup lang="ts">
import type { ChatPart } from '~/types';

const props = defineProps<{
  parts: ChatPart[];
  isActive: boolean;
  cardId: string;
  queryTracking: { startedAt: number; outputTokens: number; subAgentStartTimes: Record<string, number> } | null;
}>();

const sessionsStore = useSessionsStore();

// ── Sub-agent data ─────────────────────────────────────────────────
const subAgentCount = computed(() => sessionsStore.getActiveSubAgentCount(props.cardId));

const activeSubAgents = computed(() => {
  if (!props.queryTracking) return [];
  const startTimes = props.queryTracking.subAgentStartTimes;
  // Build list from task_started parts that are still active
  const agents: { taskId: string; description: string; startedAt: number }[] = [];
  for (const part of props.parts) {
    if (part.kind === 'task_started' && part.data.taskId) {
      const taskId = part.data.taskId as string;
      if (startTimes[taskId]) {
        agents.push({
          taskId,
          description: (part.data.description as string) || taskId,
          startedAt: startTimes[taskId],
        });
      }
    }
  }
  return agents;
});

// ── Latest progress info ───────────────────────────────────────────
const latest = computed(() => {
  const p = props.parts[props.parts.length - 1];
  if (!p) return null;
  return {
    subtype: p.kind,
    content: (p.data.description as string) || (p.data.content as string) || (p.data.status as string) || p.kind,
  };
});

const statusText = computed(() => {
  if (doneState.value) return 'Done';
  if (latest.value?.content) return latest.value.content;
  return 'Working';
});

// ── Elapsed time ───────────────────────────────────────────────────
const now = useSharedNow();

const elapsedSeconds = computed(() => {
  if (doneState.value) return doneState.value.totalTime;
  if (!props.queryTracking) return 0;
  return Math.floor((now.value - props.queryTracking.startedAt) / 1000);
});

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function subAgentElapsed(startedAt: number): string {
  const s = Math.floor((now.value - startedAt) / 1000);
  return formatTime(s);
}

// ── Token display ──────────────────────────────────────────────────
const tokenText = computed(() => {
  const tokens = doneState.value ? doneState.value.tokens : (props.queryTracking?.outputTokens ?? 0);
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k tokens`;
  return `${tokens} tokens`;
});

// ── Warning state (>30s) ───────────────────────────────────────────
const isWarning = computed(() => !doneState.value && elapsedSeconds.value > 30);

// ── Expand / collapse ──────────────────────────────────────────────
const manualOverride = ref<boolean | null>(null);

const isExpanded = computed(() => {
  if (manualOverride.value !== null) return manualOverride.value;
  return subAgentCount.value > 0;
});

function toggleExpand() {
  manualOverride.value = !isExpanded.value;
}

// ── Done state ─────────────────────────────────────────────────────
const doneState = ref<{ totalTime: number; tokens: number } | null>(null);
let doneTimeout: ReturnType<typeof setTimeout> | null = null;

const visible = computed(() => props.isActive || doneState.value !== null);
const isDone = computed(() => !props.isActive && doneState.value !== null);

// ── Lifecycle ──────────────────────────────────────────────────────
watch(() => props.isActive, (active, wasActive) => {
  if (active) {
    doneState.value = null;
    if (doneTimeout) { clearTimeout(doneTimeout); doneTimeout = null; }
  } else if (wasActive) {
    // Transition to done state
    doneState.value = {
      totalTime: elapsedSeconds.value,
      tokens: props.queryTracking?.outputTokens ?? 0,
    };
    manualOverride.value = null;
    doneTimeout = setTimeout(() => { doneState.value = null; }, 2000);
  }
}, { immediate: true });

onUnmounted(() => {
  if (doneTimeout) { clearTimeout(doneTimeout); doneTimeout = null; }
});
</script>

<template>
  <Transition name="panel-fade">
    <div
      v-if="visible"
      class="agent-progress"
      :class="{ 'is-warning': isWarning, 'is-done': isDone }"
      @click="toggleExpand"
    >
      <!-- Main row -->
      <div class="main-row">
        <span class="progress-led" :class="{ 'led-warning': isWarning, 'led-done': isDone }" />
        <span class="progress-text">{{ statusText }}</span>
        <span class="separator">·</span>
        <span class="progress-time" :class="{ 'time-warning': isWarning }">{{ formatTime(elapsedSeconds) }}</span>
        <span class="separator">·</span>
        <span class="progress-tokens">{{ tokenText }}</span>
        <span class="progress-chevron">{{ isExpanded ? '▴' : '▾' }}</span>
      </div>

      <!-- Sub-agents (expandable) -->
      <div class="sub-agents-container" :class="{ 'is-expanded': isExpanded && activeSubAgents.length > 0 }">
        <TransitionGroup name="sub-agent-fade">
          <div v-for="agent in activeSubAgents" :key="agent.taskId" class="sub-agent-row">
            <span class="sub-agent-led" />
            <span class="sub-agent-name">{{ agent.description }}</span>
            <span class="sub-agent-time">{{ subAgentElapsed(agent.startedAt) }}</span>
          </div>
        </TransitionGroup>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.agent-progress {
  padding: 6px 12px;
  margin: 2px 0;
  background: var(--bg-secondary);
  border: 1px solid var(--bg-tertiary);
  border-radius: 8px;
  font-size: 11px;
  color: var(--text-muted);
  font-family: 'SF Mono', 'Fira Code', monospace;
  cursor: pointer;
  user-select: none;
}

/* ── Main row ────────────────────────────────────────────────── */
.main-row {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  overflow: hidden;
}

.progress-led {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
  animation: pulse 1.2s ease-in-out infinite;
}
.progress-led.led-warning { background: var(--warning); }
.progress-led.led-done { background: var(--text-muted); animation: none; }

.progress-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
}
.is-done .progress-text { color: var(--text-muted); }

.separator { color: var(--bg-tertiary); flex-shrink: 0; }

.progress-time { flex-shrink: 0; }
.progress-time.time-warning { color: var(--warning); }

.progress-tokens { flex-shrink: 0; }

.progress-chevron {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 9px;
  color: var(--bg-tertiary);
}

/* ── Sub-agents ──────────────────────────────────────────────── */
.sub-agents-container {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  transition: max-height 200ms ease, opacity 200ms ease, margin-top 200ms ease;
  padding-left: 14px;
  border-left: 1px solid transparent;
  margin-left: 3px;
}
.sub-agents-container.is-expanded {
  max-height: 200px;
  opacity: 1;
  margin-top: 6px;
  border-left-color: var(--bg-tertiary);
}

.sub-agent-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  padding: 2px 0;
  color: var(--text-muted);
}

.sub-agent-led {
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #9ece6a;
  flex-shrink: 0;
  animation: pulse 1.2s ease-in-out infinite;
}

.sub-agent-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.sub-agent-time {
  flex-shrink: 0;
  margin-left: auto;
  color: var(--text-muted);
}

/* ── Sub-agent fade transition ───────────────────────────────── */
.sub-agent-fade-enter-active { transition: opacity 150ms ease; }
.sub-agent-fade-leave-active { transition: opacity 100ms ease; }
.sub-agent-fade-enter-from,
.sub-agent-fade-leave-to { opacity: 0; }

/* ── Panel fade transition ───────────────────────────────────── */
.panel-fade-enter-active { transition: opacity 200ms ease; }
.panel-fade-leave-active { transition: opacity 300ms ease; }
.panel-fade-enter-from,
.panel-fade-leave-to { opacity: 0; }

/* ── Pulse animation ─────────────────────────────────────────── */
@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.4; transform: scale(0.7); }
}
</style>
