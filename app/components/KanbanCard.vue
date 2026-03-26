<script setup lang="ts">
import type { Card, CardLinkedIssue } from '~/types';
import { deleteSessionNative, gitBranchStatus } from '~/services/claude-process';
import type { BranchStatus } from '~/services/claude-process';
import { getFilesGitStatus, type FileGitStatus } from '~/services/git-status';

const props = defineProps<{ card: Card; columnColor: string }>();
const emit = defineEmits<{
  fork: [card: Card];
}>();
const sessionsStore = useSessionsStore();
const cardsStore = useCardsStore();
const projectsStore = useProjectsStore();
const flowStore = useFlowStore();
const { openFile, activeFile } = useFileViewer();

// GitHub repo from flow store (manual override > auto-detected)
const githubRepo = computed(() => flowStore.githubRepository);

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

// Linked files git status
const fileStatuses = ref<Record<string, FileGitStatus>>({});

async function refreshFileStatuses() {
  const basePath = effectiveProjectPath.value;
  if (!basePath) return;
  const paths = Object.values(props.card.linkedFiles || {}).map(String);
  if (paths.length === 0) { fileStatuses.value = {}; return; }
  fileStatuses.value = await getFilesGitStatus(basePath, paths);
}

function fileStatusClass(filePath: string): string {
  const status = fileStatuses.value[filePath];
  if (status === 'modified') return 'file-tag--modified';
  if (status === 'missing') return 'file-tag--missing';
  return '';
}

onMounted(() => { refreshBranchStatus(); refreshFileStatuses(); });

// Refresh whenever the card transitions back to idle (query just finished)
watch(() => props.card.state, (newState) => {
  if (newState === 'idle') { refreshBranchStatus(); refreshFileStatuses(); }
});

// Refresh file statuses when linked files change
watch(() => props.card.linkedFiles, () => { refreshFileStatuses(); }, { deep: true });

const showEdit = ref(false);
const showDeleteConfirm = ref(false);
const pendingDeleteCardId = ref<string | null>(null);

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

async function openIssue(number: number) {
  if (!githubRepo.value) return;
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  openUrl(`https://github.com/${githubRepo.value}/issues/${number}`);
}

const parentCardName = computed(() => {
  if (!props.card.forkedFromId) return undefined;
  const parent = cardsStore.cards.find(c => c.id === props.card.forkedFromId);
  return parent?.name;
});

function handleEdit() {
  showEdit.value = true;
}

function handleFork() {
  emit('fork', props.card);
}

async function saveEdit(name: string, description: string, linkedFiles: Record<string, string>, linkedIssues: CardLinkedIssue[]) {
  showEdit.value = false;
  await cardsStore.updateCardInfo(props.card.id, name, description);
  await cardsStore.updateCardLinkedFiles(props.card.id, linkedFiles);
  await cardsStore.updateCardLinkedIssues(props.card.id, linkedIssues);
}

async function handleArchive(cardId: string) {
  sessionsStore.closeChat();
  await cardsStore.archiveCard(cardId);
}

async function handleUnarchive(cardId: string) {
  await cardsStore.unarchiveCard(cardId);
}

function handleDeleteRequest(cardId: string) {
  pendingDeleteCardId.value = cardId;
  showDeleteConfirm.value = true;
}

async function confirmDelete() {
  const cardId = pendingDeleteCardId.value;
  if (!cardId) return;
  showDeleteConfirm.value = false;
  pendingDeleteCardId.value = null;
  const sessionId = props.card.sessionId;
  sessionsStore.closeChat();
  await cardsStore.removeCard(cardId);
  if (sessionId && !sessionId.startsWith('pending-')) {
    deleteSessionNative(sessionId);
  }
}

// Effective project path (worktree-aware)
const effectiveProjectPath = computed(() => {
  const project = projectsStore.activeProject;
  if (!project) return '';
  const config = sessionsStore.getSessionConfig(props.card.id);
  return config.worktreePath
    || (props.card.useWorktree && props.card.worktreeName
      ? `${project.path}/.claude/worktrees/${props.card.worktreeName}`
      : project.path);
});

// File viewer integration
const linkedFilesEntries = computed(() => Object.entries(props.card.linkedFiles || {}));

function isFileActive(label: string): boolean {
  return activeFile.value?.cardId === props.card.id && activeFile.value?.label === label;
}

function onFileClick(e: MouseEvent, label: string, filePath: string) {
  e.stopPropagation();
  const basePath = effectiveProjectPath.value;
  if (!basePath) return;
  openFile(props.card.id, label, filePath.startsWith('/') ? filePath : `${basePath}/${filePath}`);
}
</script>

<template>
  <CardContextMenu
    :card-id="card.id"
    :archived="card.archived"
    @edit="handleEdit"
    @fork="handleFork"
    @archive="handleArchive"
    @unarchive="handleUnarchive"
    @delete="handleDeleteRequest"
  >
    <div
      class="kanban-card"
      :style="{ borderLeftColor: props.columnColor }"
      @click="openChat"
    >
      <!-- Quick actions overlay (hover) -->
      <div class="card-actions">
        <UButton
          v-if="sessionsStore.isActive(card.id)"
          variant="soft"
          color="error"
          size="xs"
          icon="i-lucide-square"
          title="Stop"
          @click.stop="sessionsStore.interruptSession(card.id)"
        />
        <UButton
          variant="soft"
          color="neutral"
          size="xs"
          icon="i-lucide-pencil"
          title="Edit"
          @click.stop="handleEdit"
        />
      </div>
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
            <UButton
              variant="link"
              color="neutral"
              size="xs"
              class="file-tag"
              :class="[{ 'file-tag--active': isFileActive(label) }, fileStatusClass(String(filePath))]"
              :title="String(filePath)"
              @click="onFileClick($event, label, String(filePath))"
            >{{ label }}</UButton>
            <span v-if="idx < linkedFilesEntries.length - 1" class="file-sep">|</span>
          </template>
        </div>

        <div class="card-footer">
          <span class="card-meta">{{ timeAgo(card.lastActivityAt) }}</span>
          <div class="card-footer-right">
            <span
              v-for="issue in (card.linkedIssues || [])"
              :key="issue.number"
              class="card-indicator card-indicator--issue"
              :title="`#${issue.number}${issue.title ? ' ' + issue.title : ''}`"
              @click.stop="openIssue(issue.number)"
            >
              <svg class="gh-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
              #{{ issue.number }}
            </span>
            <div v-if="branchStatus" class="branch-status" :title="`${branchStatus.branch} vs ${branchStatus.base}`">
              <span v-if="branchStatus.ahead > 0" class="commits-ahead">&uarr;{{ branchStatus.ahead }}</span>
              <span v-if="branchStatus.behind > 0" class="commits-behind">&darr;{{ branchStatus.behind }}</span>
              <span v-if="branchStatus.ahead === 0 && branchStatus.behind === 0" class="commits-synced">&check;</span>
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
          <span class="cost-tokens">&uarr;{{ formatTokens(card.inputTokens) }} &darr;{{ formatTokens(card.outputTokens) }}</span>
        </div>
      </div>
    </div>
  </CardContextMenu>

  <EditCardDialog
    v-if="showEdit"
    v-model:open="showEdit"
    :name="card.name"
    :description="card.description"
    :linked-files="card.linkedFiles"
    :linked-issues="card.linkedIssues"
    :github-repo="githubRepo"
    :project-path="effectiveProjectPath"
    @save="saveEdit"
    @cancel="showEdit = false"
  />

  <!-- Delete confirmation modal -->
  <UModal v-model:open="showDeleteConfirm" title="Delete session?">
    <template #body>
      <p class="text-sm">Delete "{{ card.name }}" and its Claude session? This cannot be undone.</p>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton variant="ghost" color="neutral" @click="showDeleteConfirm = false">Cancel</UButton>
        <UButton color="error" @click="confirmDelete">Delete</UButton>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.kanban-card {
  position: relative;
  background: var(--bg-secondary);
  border-left: 3px solid;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}
.kanban-card:hover { background: var(--bg-tertiary); }

/* Quick actions overlay */
.card-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  gap: 4px;
  z-index: 1;
  opacity: 0;
  transition: opacity 0.15s;
  pointer-events: none;
}
.kanban-card:hover .card-actions {
  opacity: 1;
  pointer-events: auto;
}
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
  padding: 0 !important;
  font-size: 11px !important;
  color: var(--text-muted) !important;
  text-decoration: none !important;
  min-height: auto !important;
  height: auto !important;
}
.file-tag:hover {
  color: var(--text-secondary) !important;
  text-decoration: underline !important;
}
.file-tag--active {
  color: var(--accent, #7c8aff) !important;
  font-weight: 600;
}
.file-tag--modified {
  color: var(--warning, #f59e0b) !important;
}
.file-tag--missing {
  color: var(--error, #f87171) !important;
  text-decoration: line-through !important;
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
.card-indicator--issue { color: var(--accent); font-family: 'SF Mono', 'Fira Code', monospace; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 2px; }
.card-indicator--issue:hover { opacity: 0.8; }
.gh-icon { width: 12px; height: 12px; flex-shrink: 0; }
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
