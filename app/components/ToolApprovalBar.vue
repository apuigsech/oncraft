<script setup lang="ts">
import type { ChatPart } from '~/types';

const props = defineProps<{ part: ChatPart; cardId: string }>();
const sessionsStore = useSessionsStore();

const toolName = computed(() => (props.part.data.toolName as string) || '');
const toolInput = computed(() => (props.part.data.toolInput as Record<string, unknown>) || {});

// SDK-provided permission prompt fields (0.2.84+)
const sdkTitle = computed(() => (props.part.data.title as string) || '');
const sdkDescription = computed(() => (props.part.data.description as string) || '');
const sdkDisplayName = computed(() => (props.part.data.displayName as string) || '');

const summary = computed(() => {
  // Use SDK-provided title when available
  if (sdkTitle.value) return sdkTitle.value;
  const input = toolInput.value;
  const name = toolName.value;
  switch (name) {
    case 'Bash': return `$ ${(input.command as string || '').substring(0, 80)}`;
    case 'Read': return `${input.file_path}`;
    case 'Write': return `${input.file_path}`;
    case 'Edit': return `${input.file_path}`;
    case 'Glob': return `${input.pattern}`;
    case 'Grep': return `"${input.pattern}" in ${input.path || '.'}`;
    case 'WebFetch': return `${(input.url as string || '').substring(0, 60)}`;
    case 'Agent': return `${input.description || (input.prompt as string || '').substring(0, 50)}`;
    default: return name;
  }
});

const displayLabel = computed(() => sdkDisplayName.value || toolName.value);

const isResolved = computed(() => !!props.part.resolved);
const answer = computed(() => (props.part.data.answer as string) || '');

async function approve() {
  await sessionsStore.approveToolUse(props.cardId);
  sessionsStore.resolveActionPart(props.cardId, props.part.id, 'Allowed');
}

async function deny() {
  await sessionsStore.rejectToolUse(props.cardId);
  sessionsStore.resolveActionPart(props.cardId, props.part.id, 'Denied');
}
</script>

<template>
  <!-- Resolved: compact inline record -->
  <div v-if="isResolved" class="approval-resolved">
    <span class="resolved-icon">&#x1F6E1;</span>
    <span class="resolved-tool">{{ displayLabel }}</span>
    <span class="resolved-summary">{{ summary }}</span>
    <span class="resolved-arrow">&rarr;</span>
    <span class="resolved-answer" :class="{ denied: answer === 'Denied' }">{{ answer }}</span>
  </div>

  <!-- Active: approval prompt -->
  <div v-else class="tool-approval-bar">
    <div class="approval-info">
      <span class="approval-tool-name">{{ displayLabel }}</span>
      <span class="approval-summary">{{ summary }}</span>
      <span v-if="sdkDescription" class="approval-description">{{ sdkDescription }}</span>
    </div>
    <div class="approval-actions">
      <UButton color="success" size="sm" @click="approve">Allow</UButton>
      <UButton variant="ghost" color="neutral" size="sm" @click="deny">Deny</UButton>
    </div>
  </div>
</template>

<style scoped>
.tool-approval-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--warning);
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 10px 14px;
}

.approval-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.approval-tool-name {
  font-weight: 700;
  font-size: 13px;
  flex-shrink: 0;
}

.approval-summary {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.approval-description {
  font-size: 11px;
  color: var(--text-secondary);
  width: 100%;
  flex-shrink: 0;
}

.approval-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* ── Resolved (compact inline) ── */
.approval-resolved {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--bg-tertiary);
  border-radius: 6px;
  font-size: 12px;
}
.resolved-icon { font-size: 13px; flex-shrink: 0; }
.resolved-tool { font-weight: 600; color: var(--text-secondary); flex-shrink: 0; }
.resolved-summary {
  color: var(--text-muted);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;
}
.resolved-arrow { color: var(--text-muted); flex-shrink: 0; }
.resolved-answer { color: var(--success); font-weight: 600; }
.resolved-answer.denied { color: var(--error); }
</style>
