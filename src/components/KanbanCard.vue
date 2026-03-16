<script setup lang="ts">
import { ref } from 'vue';
import type { Card } from '../types';
import StatusIndicator from './StatusIndicator.vue';
import CardContextMenu from './CardContextMenu.vue';
import { useSessionsStore } from '../stores/sessions';
import { useCardsStore } from '../stores/cards';
import { deleteSessionViaSidecar } from '../services/claude-process';

const props = defineProps<{ card: Card; columnColor: string }>();
const sessionsStore = useSessionsStore();
const cardsStore = useCardsStore();

const showMenu = ref(false);
const menuX = ref(0);
const menuY = ref(0);

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

function onContextMenu(e: MouseEvent) {
  e.preventDefault();
  menuX.value = e.clientX;
  menuY.value = e.clientY;
  showMenu.value = true;
}

async function handleArchive(cardId: string) {
  showMenu.value = false;
  sessionsStore.closeChat();
  await cardsStore.archiveCard(cardId);
}

async function handleUnarchive(cardId: string) {
  showMenu.value = false;
  await cardsStore.unarchiveCard(cardId);
}

async function handleDelete(cardId: string) {
  showMenu.value = false;
  if (!confirm(`Delete "${props.card.name}" and its Claude session? This cannot be undone.`)) return;
  const sessionId = props.card.sessionId;
  sessionsStore.closeChat();
  // Remove from board immediately
  await cardsStore.removeCard(cardId);
  // Delete Claude session file in background
  if (sessionId && !sessionId.startsWith('pending-')) {
    deleteSessionViaSidecar(sessionId);
  }
}
</script>

<template>
  <div class="kanban-card" :style="{ borderLeftColor: props.columnColor }"
    @click="openChat" @contextmenu="onContextMenu">
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
    <CardContextMenu
      v-if="showMenu"
      :x="menuX" :y="menuY" :card-id="card.id" :archived="card.archived"
      @archive="handleArchive" @unarchive="handleUnarchive"
      @delete="handleDelete" @close="showMenu = false"
    />
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
