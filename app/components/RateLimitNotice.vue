<script setup lang="ts">
import type { ChatPart } from '~/types';

const props = defineProps<{ part: ChatPart; cardId: string }>();

const rateLimitInfo = computed(() => (props.part.data.rateLimitInfo as Record<string, unknown>) || {});

const infoEntries = computed(() => {
  return Object.entries(rateLimitInfo.value).filter(([_, v]) => v !== null && v !== undefined);
});
</script>

<template>
  <div class="rate-limit-notice">
    <UIcon name="i-lucide-clock" class="rate-limit-icon" />
    <span class="rate-limit-text">Rate limited</span>
    <span v-for="[key, value] in infoEntries" :key="key" class="rate-limit-info">
      {{ key }}: {{ value }}
    </span>
  </div>
</template>

<style scoped>
.rate-limit-notice {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  background: rgba(251, 191, 36, 0.08);
  border: 1px solid rgba(251, 191, 36, 0.3);
  border-radius: 6px;
  padding: 8px 12px;
}

.rate-limit-icon {
  font-size: 16px;
  color: var(--warning);
  flex-shrink: 0;
}

.rate-limit-text {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 600;
}

.rate-limit-info {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 11px;
  color: var(--text-muted);
}
</style>
