<script setup lang="ts">
import type { ChatPart } from '~/types';

const props = defineProps<{ part: ChatPart; cardId: string }>();
const sessionsStore = useSessionsStore();

const suggestion = computed(() => (props.part.data.suggestion as string) || '');

function sendSuggestion() {
  sessionsStore.send(props.cardId, suggestion.value);
  sessionsStore.resolveActionPart(props.cardId, props.part.id);
}

function dismiss() {
  sessionsStore.resolveActionPart(props.cardId, props.part.id);
}
</script>

<template>
  <div class="prompt-suggestion-bar">
    <span class="suggestion-label">Suggested:</span>
    <UButton
      variant="outline"
      size="sm"
      class="suggestion-btn"
      @click="sendSuggestion"
    >
      {{ suggestion }}
    </UButton>
    <UButton
      variant="ghost"
      size="xs"
      class="dismiss-btn"
      @click="dismiss"
    >
      <UIcon name="i-lucide-x" />
    </UButton>
  </div>
</template>

<style scoped>
.prompt-suggestion-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  background: var(--bg-secondary);
  border: 1px solid var(--bg-tertiary);
  border-radius: 8px;
  padding: 8px 12px;
}

.suggestion-label {
  font-size: 10px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.suggestion-btn {
  border-radius: 999px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dismiss-btn {
  flex-shrink: 0;
}
</style>
