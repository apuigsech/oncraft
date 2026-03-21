<script setup lang="ts">
import type { Card } from '~/types';
import { deleteSessionNative, gitBranchStatus } from '~/services/claude-process';
import type { BranchStatus } from '~/services/claude-process';

const props = defineProps<{ card: Card; columnColor: string }>();
const sessionsStore = useSessionsStore();
const cardsStore = useCardsStore();
const projectsStore = useProjectsStore();

// Branch ahead/behind status
const branchStatus = ref<BranchStatus | null>(null);

async function refreshBranchStatus() {
  const project = projectsStore.activeProject;
  if (!project) return;

  // Prefer the worktree branch, then the session-config git branch, then HEAD
  const config = sessionsStore.getSessionConfig(props.card.id);
  const branch = props.card.worktreeName
    ? props.card.worktreeName
    : (config.gitBranch ?? undefined);

  // Use worktree path as the repo root when available, otherwise the project path
  const repoPath = config.worktreePath || project.path;

  const status = await gitBranchStatus(repoPath, branch);
  if (status && !status.error) {
    branchStatus.value = status;
  }
}

onMounted(() => { refreshBranchStatus(); });

// Refresh whenever the card transitions back to idle (query just finished)
watch(() => props.card.state, (newState) => {
  if (newState === 'idle') refreshBranchStatus();
});

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

function formatTokens(n: number): string {
  if (!n || n < 1000) return String(n || 0);
  return `${(n / 1000).toFixed(1)}k`;
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
    deleteSessionNative(sessionId);
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
        <div class="card-footer-right">
          <div v-if="branchStatus" class="branch-status" :title="`${branchStatus.branch} vs ${branchStatus.base}`">
            <span v-if="branchStatus.ahead > 0" class="commits-ahead">↑{{ branchStatus.ahead }}</span>
            <span v-if="branchStatus.behind > 0" class="commits-behind">↓{{ branchStatus.behind }}</span>
            <span v-if="branchStatus.ahead === 0 && branchStatus.behind === 0" class="commits-synced">✓</span>
          </div>
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
      <div v-if="card.costUsd && card.costUsd > 0" class="card-cost-footer">
        <span class="cost-amount">${{ card.costUsd.toFixed(4) }}</span>
        <span class="cost-tokens">↑{{ formatTokens(card.inputTokens) }} ↓{{ formatTokens(card.outputTokens) }}</span>
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
.card-footer-right { display: flex; align-items: center; gap: 6px; }
.card-meta { font-size: 11px; color: var(--text-muted); }
.card-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.branch-status { display: flex; align-items: center; gap: 3px; font-size: 11px; font-family: 'SF Mono', 'Fira Code', monospace; }
.commits-ahead  { color: #4ade80; font-weight: 600; }
.commits-behind { color: #f87171; font-weight: 600; }
.commits-synced { color: var(--text-muted); }
.card-cost-footer {
  display: flex;
  gap: 8px;
  padding-top: 6px;
  margin-top: 6px;
  border-top: 1px solid var(--bg-tertiary);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 10px;
  color: var(--text-muted);
}
.cost-amount { white-space: nowrap; }
.cost-tokens { white-space: nowrap; }
</style>
