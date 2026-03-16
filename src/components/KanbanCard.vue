<script setup lang="ts">
import { ref } from 'vue';
import type { Card } from '../types';
import StatusIndicator from './StatusIndicator.vue';
import CardContextMenu from './CardContextMenu.vue';
import EditCardDialog from './EditCardDialog.vue';
import { useSessionsStore } from '../stores/sessions';
import { useCardsStore } from '../stores/cards';
import { deleteSessionViaSidecar } from '../services/claude-process';

const props = defineProps<{ card: Card; columnColor: string }>();
const sessionsStore = useSessionsStore();
const cardsStore = useCardsStore();

const showMenu = ref(false);
const showEdit = ref(false);
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

function handleEdit() {
  showMenu.value = false;
  showEdit.value = true;
}

async function saveEdit(name: string, description: string) {
  showEdit.value = false;
  await cardsStore.updateCardInfo(props.card.id, name, description);
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
  await cardsStore.removeCard(cardId);
  if (sessionId && !sessionId.startsWith('pending-')) {
    deleteSessionViaSidecar(sessionId);
  }
}
</script>

<template>
  <div
    class="kanban-card"
    :style="{ borderLeftColor: props.columnColor }"
    @click="openChat"
    @contextmenu="onContextMenu"
  >
    <div class="card-inner">
      <div class="card-header">
        <span class="card-name">{{ card.name }}</span>
        <UBadge
          v-if="card.useWorktree"
          variant="soft"
          color="primary"
          size="xs"
          class="worktree-badge"
          :title="'Worktree: ' + (card.worktreeName || '')"
        >WT</UBadge>
        <StatusIndicator :state="card.state" />
      </div>
      <p v-if="card.description" class="card-desc">{{ card.description }}</p>
      <div class="card-footer">
        <span class="card-meta">{{ timeAgo(card.lastActivityAt) }}</span>
        <div v-if="card.tags?.length" class="card-tags">
          <UBadge
            v-for="tag in card.tags"
            :key="tag"
            variant="soft"
            color="neutral"
            size="sm"
          >{{ tag }}</UBadge>
        </div>
      </div>
    </div>

    <CardContextMenu
      v-if="showMenu"
      :x="menuX" :y="menuY" :card-id="card.id" :archived="card.archived"
      @edit="handleEdit" @archive="handleArchive" @unarchive="handleUnarchive"
      @delete="handleDelete" @close="showMenu = false"
    />
    <EditCardDialog
      v-if="showEdit"
      :name="card.name" :description="card.description"
      @save="saveEdit" @cancel="showEdit = false"
    />
  </div>
</template>

<style scoped>
.kanban-card {
  background: var(--bg-secondary);
  border-left: 3px solid;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}
.kanban-card:hover { background: var(--bg-tertiary); }
.card-inner { padding: 10px; }
.card-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.card-name { font-size: 13px; font-weight: 600; flex: 1; min-width: 0; }
.worktree-badge { flex-shrink: 0; font-family: 'SF Mono', 'Fira Code', monospace; letter-spacing: 0.5px; }
.card-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-footer { display: flex; justify-content: space-between; align-items: center; }
.card-meta { font-size: 11px; color: var(--text-muted); }
.card-tags { display: flex; gap: 4px; flex-wrap: wrap; }
</style>
