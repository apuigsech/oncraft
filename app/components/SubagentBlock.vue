<script setup lang="ts">
import type { ChatPart } from '~/types';

const props = defineProps<{ part: ChatPart; cardId: string }>();

const sessionsStore = useSessionsStore();

const toolUseId = computed(() => (props.part.data.toolUseId as string) || '');
const description = computed(() => (props.part.data.description as string) || 'Subagent');
const toolResult = computed(() => props.part.data.toolResult as string | undefined);

// Collect all child parts that belong to this subagent
const childParts = computed(() => {
  const allParts = sessionsStore.getMessages(props.cardId);
  return allParts.filter(p =>
    (p.data.parentToolUseId as string) === toolUseId.value,
  );
});

// State: running / completed / error
const state = computed(() => {
  if (toolResult.value) {
    const result = typeof toolResult.value === 'string' ? toolResult.value : '';
    // Only mark as error if the result starts with an error pattern (not just contains "error" anywhere)
    if (/^(Error:|error:|ERROR:|Failed|failed|Traceback)/.test(result.trim())) {
      return 'error';
    }
    return 'completed';
  }
  return 'running';
});

// Auto-expand when running, collapse when done
const manualOverride = ref<boolean | null>(null);
const isExpanded = computed(() => {
  if (manualOverride.value !== null) return manualOverride.value;
  return state.value === 'running';
});

const collapsibleOpen = computed({
  get: () => isExpanded.value,
  set: (next: boolean) => { manualOverride.value = next; },
});

// Reset manual override when state changes; stop timer when no longer running
watch(state, (newState) => {
  manualOverride.value = null;
  if (newState !== 'running') return;
});

// Elapsed time tracking
const startedAt = ref(Date.now());
const now = useSharedNow();

const elapsedSeconds = computed(() => Math.floor((now.value - startedAt.value) / 1000));

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

// Token tracking from child assistant parts
const tokenCount = computed(() => {
  let tokens = 0;
  for (const p of childParts.value) {
    if (p.kind === 'assistant' && p.data.usage) {
      tokens += ((p.data.usage as { outputTokens?: number }).outputTokens ?? 0);
    }
  }
  return tokens;
});

const tokenText = computed(() => {
  if (tokenCount.value >= 1000) return `${(tokenCount.value / 1000).toFixed(1)}k tokens`;
  return `${tokenCount.value} tokens`;
});

function isChildSynthetic(part: ChatPart): boolean {
  return part.kind === 'user' && (part.data.isSynthetic as boolean) === true;
}

function isChildToolUse(part: ChatPart): boolean {
  return part.kind === 'tool_use' || part.kind.startsWith('tool_use:');
}

</script>

<template>
  <UCollapsible v-model:open="collapsibleOpen" class="subagent-block" :class="state" :unmount-on-hide="false">
    <UButton
      variant="ghost"
      color="neutral"
      block
      class="subagent-header"
      trailing-icon="i-lucide-chevron-down"
      :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
    >
      <span class="subagent-led" />
      <span class="subagent-label">Agent</span>
      <span class="subagent-desc">{{ description }}</span>
      <span class="subagent-meta">
        <span>{{ formatTime(elapsedSeconds) }}</span>
        <template v-if="state !== 'running'">
          <span>&middot;</span>
          <span>{{ tokenText }}</span>
        </template>
      </span>
    </UButton>

    <template #content>
      <div class="subagent-body">
        <div class="subagent-chat">
          <template v-for="child in childParts" :key="child.id">
            <div v-if="isChildSynthetic(child)" class="sub-synthetic">
              &#8627; Subagent prompt
            </div>

            <div v-else-if="isChildToolUse(child)" class="sub-tool-wrapper">
              <ToolCallBlock :part="child" :card-id="cardId" />
            </div>

            <div v-else-if="child.kind === 'assistant' && !child.data.thinking" class="sub-assistant">
              {{ ((child.data.content as string) || '').substring(0, 300) }}
              <span v-if="((child.data.content as string) || '').length > 300" class="sub-truncated">...</span>
            </div>
          </template>

          <div v-if="toolResult" class="sub-result">
            <strong>Result:</strong> {{ typeof toolResult === 'string' ? toolResult.substring(0, 500) : '' }}
          </div>
        </div>
      </div>
    </template>
  </UCollapsible>
</template>

<style scoped>
.subagent-block {
  background: var(--bg-primary);
  border: 1px solid var(--bg-tertiary);
  border-left: 3px solid var(--accent);
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 200ms;
}
.subagent-block.running  { border-left-color: var(--warning); }
.subagent-block.completed { border-left-color: var(--success); }
.subagent-block.error    { border-left-color: var(--error); }

.subagent-header {
  justify-content: flex-start !important;
  padding: 8px 12px !important;
  font-size: 12px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  transition: background 150ms;
}
.subagent-header:hover { background: var(--bg-secondary); }

.subagent-led {
  width: 6px; height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.running .subagent-led  { background: var(--warning); animation: pulse 1.2s ease-in-out infinite; }
.completed .subagent-led { background: var(--success); }
.error .subagent-led    { background: var(--error); }

.subagent-label { color: var(--text-muted); font-size: 11px; }
.subagent-desc {
  color: var(--text-secondary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.subagent-meta {
  display: flex;
  gap: 6px;
  color: var(--text-muted);
  font-size: 11px;
  flex-shrink: 0;
}
.subagent-body {
  border-top: 1px solid var(--bg-tertiary);
  padding: 10px 12px;
  background: var(--bg-primary);
}

.subagent-chat { display: flex; flex-direction: column; gap: 6px; }

.sub-synthetic {
  padding: 3px 10px;
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
  opacity: 0.6;
}

.sub-tool-wrapper {
  opacity: 0.75;
}

.sub-assistant {
  padding: 4px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
}
.sub-truncated { color: var(--text-muted); }

.sub-result {
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-muted);
  border-top: 1px solid var(--bg-tertiary);
  margin-top: 4px;
  padding-top: 8px;
  line-height: 1.4;
}
.sub-result strong { color: var(--text-secondary); font-weight: 500; }

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.4; transform: scale(0.7); }
}
</style>
