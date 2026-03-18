<script setup lang="ts">
import type { ChatPart } from '~/types';

const props = defineProps<{ part: ChatPart; cardId: string }>();

const message = computed(() => (props.part.data.message as string) || '');
const retryAfter = computed(() => props.part.data.retryAfter as number | undefined);
</script>

<template>
  <div class="error-notice">
    <UIcon name="i-lucide-alert-triangle" class="error-icon" />
    <span class="error-message">{{ message }}</span>
    <span v-if="retryAfter" class="error-retry">Retrying in {{ retryAfter }}s...</span>
  </div>
</template>

<style scoped>
.error-notice {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 6px;
  padding: 8px 12px;
}

.error-icon {
  font-size: 16px;
  color: var(--error);
  flex-shrink: 0;
}

.error-message {
  font-size: 12px;
  color: var(--text-secondary);
  flex: 1;
  word-break: break-word;
}

.error-retry {
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}
</style>
