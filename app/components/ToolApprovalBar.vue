<script setup lang="ts">
import type { ChatPart } from '~/types';

const props = defineProps<{ part: ChatPart; cardId: string }>();
const sessionsStore = useSessionsStore();

const toolName = computed(() => (props.part.data.toolName as string) || '');
const toolInput = computed(() => (props.part.data.toolInput as Record<string, unknown>) || {});

const summary = computed(() => {
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

async function approve() {
  await sessionsStore.approveToolUse(props.cardId);
  sessionsStore.resolveActionPart(props.cardId, props.part.id);
}

async function deny() {
  await sessionsStore.rejectToolUse(props.cardId);
  sessionsStore.resolveActionPart(props.cardId, props.part.id);
}
</script>

<template>
  <div class="tool-approval-bar">
    <div class="approval-info">
      <span class="approval-tool-name">{{ toolName }}</span>
      <span class="approval-summary">{{ summary }}</span>
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

.approval-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
</style>
