<script setup lang="ts">
import type { Card, CardLinkedIssue } from '~/types';
import { deleteSessionNative, gitBranchStatus } from '~/services/claude-process';
import type { BranchStatus } from '~/services/claude-process';

const props = defineProps<{ card: Card; columnColor: string }>();
const emit = defineEmits<{
  fork: [card: Card];
}>();
const sessionsStore = useSessionsStore();
const cardsStore = useCardsStore();
const projectsStore = useProjectsStore();
const pipelinesStore = usePipelinesStore();
const { openFile, activeFile } = useFileViewer();

// GitHub repo from project config (for issue linking)
const githubRepo = computed(() => {
  const project = projectsStore.activeProject;
  if (!project) return undefined;
  return pipelinesStore.getConfig(project.path)?.github?.repository;
});

// Counts for indicators
const linkedFilesCount = computed(() => Object.keys(props.card.linkedFiles || {}).length);
const linkedIssuesCount = computed(() => (props.card.linkedIssues || []).length);

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

const parentCardName = computed(() => {
  if (!props.card.forkedFromId) return undefined;
  const parent = cardsStore.cards.find(c => c.id === props.card.forkedFromId);
  return parent?.name;
});

function handleEdit() {
  showMenu.value = false;
  showEdit.value = true;
}

function handleFork() {
  showMenu.value = false;
  emit('fork', props.card);
}

async function saveEdit(name: string, description: string, linkedFiles: Record<string, string>, linkedIssues: CardLinkedIssue[]) {
  showEdit.value = false;
  await cardsStore.updateCardInfo(props.card.id, name, description);
  await cardsStore.updateCardLinkedFiles(props.card.id, linkedFiles);
  await cardsStore.updateCardLinkedIssues(props.card.id, linkedIssues);
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

// File viewer integration
const linkedFilesEntries = computed(() => Object.entries(props.card.linkedFiles || {}));

function isFileActive(label: string): boolean {
  return activeFile.value?.cardId === props.card.id && activeFile.value?.label === label;
}

function onFileClick(e: MouseEvent, label: string, filePath: string) {
  e.stopPropagation();
  const project = projectsStore.activeProject;
  if (!project) return;
  const config = sessionsStore.getSessionConfig(props.card.id);
  const basePath = config.worktreePath || project.path;
  openFile(props.card.id, label, filePath.startsWith('/') ? filePath : `${basePath}/${filePath}`);
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
        <UBadge
          v-if="card.forkedFromId"
          variant="soft"
          color="warning"
          size="xs"
          class="fork-badge"
          :title="parentCardName ? 'Forked from ' + parentCardName : 'Fork'"
        >Fork</UBadge>
        <StatusIndicator :state="card.state" />
      </div>
      <p v-if="card.description" class="card-desc">{{ card.description }}</p>
      <!-- Linked file tags -->
      <div v-if="linkedFilesEntries.length > 0" class="card-files">
        <template v-for="([label, filePath], idx) in linkedFilesEntries" :key="label">
          <button
            class="file-tag"
            :class="{ 'file-tag--active': isFileActive(label) }"
            :title="String(filePath)"
            @click="onFileClick($event, label, String(filePath))"
          >{{ label }}</button>
          <span v-if="idx < linkedFilesEntries.length - 1" class="file-sep">|</span>
        </template>
      </div>

      <div class="card-footer">
        <span class="card-meta">{{ timeAgo(card.lastActivityAt) }}</span>
        <div class="card-footer-right">
          <span
            v-if="linkedIssuesCount > 0"
            class="card-indicator card-indicator--issue"
            :title="(card.linkedIssues || []).map(i => `#${i.number}${i.title ? ' ' + i.title : ''}`).join('\n')"
          >#{{ (card.linkedIssues || []).map(i => i.number).join(' #') }}</span>
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
      @edit="handleEdit" @fork="handleFork" @archive="handleArchive" @unarchive="handleUnarchive"
      @delete="handleDelete" @close="showMenu = false"
    />
    <EditCardDialog
      v-if="showEdit"
      :name="card.name"
      :description="card.description"
      :linked-files="card.linkedFiles"
      :linked-issues="card.linkedIssues"
      :github-repo="githubRepo"
      @save="saveEdit"
      @cancel="showEdit = false"
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
.fork-badge { flex-shrink: 0; }
.card-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-files {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0;
  margin-bottom: 6px;
}
.file-tag {
  background: none;
  border: none;
  padding: 0;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  font-family: inherit;
  transition: color 0.12s;
}
.file-tag:hover {
  color: var(--text-secondary);
  text-decoration: underline;
}
.file-tag--active {
  color: var(--accent, #7c8aff);
  font-weight: 600;
}
.file-sep {
  color: var(--border, #3a3a4e);
  margin: 0 5px;
  font-weight: 300;
}
.card-footer { display: flex; justify-content: space-between; align-items: center; }
.card-footer-right { display: flex; align-items: center; gap: 6px; }
.card-meta { font-size: 11px; color: var(--text-muted); }
.card-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.card-indicator { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
.card-indicator--issue { color: var(--accent); font-family: 'SF Mono', 'Fira Code', monospace; font-weight: 600; }
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
