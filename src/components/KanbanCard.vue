<script setup lang="ts">
import type { Card } from '../types';
import StatusIndicator from './StatusIndicator.vue';
import { useSessionsStore } from '../stores/sessions';

const props = defineProps<{ card: Card; columnColor: string }>();
const sessionsStore = useSessionsStore();

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function openChat() { sessionsStore.openChat(props.card.id); }
</script>

<template>
  <div class="kanban-card" :style="{ borderLeftColor: props.columnColor }" @click="openChat">
    <div class="card-header">
      <span class="card-name">{{ card.name }}</span>
      <StatusIndicator :state="card.state" />
    </div>
    <p v-if="card.description" class="card-desc">{{ card.description }}</p>
    <div class="card-footer">
      <span class="card-meta">{{ timeAgo(card.lastActivityAt) }}</span>
      <div class="card-tags">
        <span v-for="tag in card.tags" :key="tag" class="tag">{{ tag }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kanban-card {
  background: var(--bg-secondary); border-left: 3px solid; border-radius: 6px;
  padding: 10px; cursor: pointer; transition: background 0.15s;
}
.kanban-card:hover { background: var(--bg-tertiary); }
.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.card-name { font-size: 13px; font-weight: 600; }
.card-desc { font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-footer { display: flex; justify-content: space-between; align-items: center; }
.card-meta { font-size: 11px; color: var(--text-muted); }
.card-tags { display: flex; gap: 4px; }
.tag { font-size: 10px; padding: 1px 6px; border-radius: 3px; background: var(--bg-tertiary); color: var(--text-secondary); }
</style>
