<script setup lang="ts">
import type { ChatPart } from '~/types';

defineProps<{
  part: ChatPart;
  cardId: string;
}>();

const expanded = ref<Record<string, boolean>>({});

function toggleExpand(key: string) {
  expanded.value[key] = !expanded.value[key];
}

function isInternalKey(key: string): boolean {
  return key.startsWith('_') || key === 'type' || key === 'raw';
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function isLongValue(value: unknown): boolean {
  return formatValue(value).length > 100;
}

function truncateValue(value: unknown): string {
  const str = formatValue(value);
  return str.length > 100 ? str.slice(0, 100) + '...' : str;
}

function visibleEntries(data: Record<string, unknown>): [string, unknown][] {
  return Object.entries(data).filter(([key, value]) => {
    if (isInternalKey(key)) return false;
    const str = formatValue(value);
    if (str.length > 1000) return false;
    return true;
  });
}
</script>

<template>
  <div class="generic-block">
    <UBadge variant="subtle" color="neutral" size="xs" class="kind-badge">
      {{ part.kind }}
    </UBadge>
    <div class="kv-list">
      <template v-for="[key, value] in visibleEntries(part.data)" :key="key">
        <span class="kv-item">
          <span class="kv-key">{{ key }}:</span>
          <span v-if="isLongValue(value) && !expanded[key]" class="kv-value truncated">
            {{ truncateValue(value) }}
            <UButton variant="link" color="primary" size="xs" class="expand-toggle" @click="toggleExpand(key)">[show more]</UButton>
          </span>
          <span v-else-if="isLongValue(value) && expanded[key]" class="kv-value">
            {{ formatValue(value) }}
            <UButton variant="link" color="primary" size="xs" class="expand-toggle" @click="toggleExpand(key)">[show less]</UButton>
          </span>
          <span v-else class="kv-value">{{ formatValue(value) }}</span>
        </span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.generic-block {
  background: var(--bg-secondary);
  border: 1px solid var(--bg-tertiary);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-secondary);
}

.kind-badge {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  margin-bottom: 4px;
}

.kv-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 11px;
  line-height: 1.5;
}

.kv-item {
  display: inline-flex;
  gap: 4px;
  align-items: baseline;
}

.kv-key {
  color: var(--text-muted);
  flex-shrink: 0;
}

.kv-value {
  color: var(--text-secondary);
  word-break: break-word;
}

.kv-value.truncated {
  cursor: default;
}

.expand-toggle {
  font-size: 10px;
  margin-left: 2px;
  user-select: none;
  padding: 0 !important;
  min-height: auto !important;
  height: auto !important;
}

.expand-toggle:hover {
  text-decoration: underline;
}
</style>
