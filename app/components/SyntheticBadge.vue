<script setup lang="ts">
import type { ChatPart } from '~/types';

const props = defineProps<{ part: ChatPart; cardId: string }>();

const isExpanded = ref(false);
function toggle() { isExpanded.value = !isExpanded.value; }

const content = computed(() => (props.part.data.content as string) || '');

// Detect the type of synthetic message from content
const badge = computed(() => {
  const text = content.value;

  // Skill loaded: look for <command-name> tag
  const cmdMatch = text.match(/<command-name>\/?([^<]+)<\/command-name>/);
  if (cmdMatch) {
    return { icon: 'i-lucide-puzzle', type: 'Skill loaded', name: cmdMatch[1].trim() };
  }

  // System reminder: look for <system-reminder> tag
  if (text.includes('<system-reminder>')) {
    const afterTag = text.replace(/<\/?system-reminder>/g, '').trim();
    const firstLine = afterTag.split('\n').find(l => l.trim())?.trim() || 'System';
    return { icon: 'i-lucide-bell', type: 'System', name: firstLine.substring(0, 50) };
  }

  // Generic internal message
  return { icon: 'i-lucide-eye-off', type: 'Internal', name: text.substring(0, 40).trim() };
});
</script>

<template>
  <div class="synthetic-badge" @click="toggle">
    <div class="badge-header">
      <UIcon :name="badge.icon" class="badge-icon" />
      <span class="badge-type">{{ badge.type }}</span>
      <span class="badge-name">{{ badge.name }}</span>
      <UIcon
        name="i-lucide-chevron-down"
        class="badge-chevron"
        :class="{ open: isExpanded }"
      />
    </div>
    <div v-if="isExpanded" class="badge-content">
      {{ content }}
    </div>
  </div>
</template>

<style scoped>
.synthetic-badge {
  background: var(--bg-secondary);
  border: 1px solid var(--bg-tertiary);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  cursor: pointer;
  user-select: none;
  transition: border-color 150ms, background 150ms;
}
.synthetic-badge:hover { border-color: var(--border); }

.badge-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.badge-icon { font-size: 14px; color: var(--text-muted); flex-shrink: 0; }
.badge-type { color: var(--accent); font-weight: 500; font-size: 11px; }
.badge-name { color: var(--text-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge-chevron {
  margin-left: auto;
  font-size: 12px;
  color: var(--bg-tertiary);
  transition: transform 200ms;
  flex-shrink: 0;
}
.badge-chevron.open { transform: rotate(180deg); }

.badge-content {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--bg-tertiary);
  font-size: 11px;
  color: var(--text-muted);
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  line-height: 1.4;
}
</style>
