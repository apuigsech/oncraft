<script setup lang="ts">
import type { Card, CardLinkedIssue } from '~/types';
import { deleteSessionNative, gitBranchStatus } from '~/services/claude-process';
import type { BranchStatus } from '~/services/claude-process';
import { getFilesGitStatus, type FileGitStatus } from '~/services/git-status';

const props = defineProps<{ card: Card }>();
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

// Dropdown menu items for the ⋯ button
const menuItems = computed(() => {
  const groups: any[][] = [];

  // Group 1: Stop (only if active)
  if (sessionsStore.isActive(props.card.id)) {
    groups.push([{
      label: 'Stop',
      icon: 'i-lucide-square',
      color: 'error' as const,
      onSelect: () => sessionsStore.interruptSession(props.card.id),
    }]);
  }

  // Group 2: Edit, Fork
  groups.push([
    { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => handleEdit() },
    { label: 'Fork', icon: 'i-lucide-git-branch', onSelect: () => handleFork() },
  ]);

  // Group 3: Archive/Delete
  groups.push([
    props.card.archived
      ? { label: 'Unarchive', icon: 'i-lucide-archive-restore', onSelect: () => handleUnarchive(props.card.id) }
      : { label: 'Archive', icon: 'i-lucide-archive', onSelect: () => handleArchive(props.card.id) },
    { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => handleDeleteRequest(props.card.id) },
  ]);

  return groups;
});

// Whether the card has a deliberate branch association (worktree or configured gitBranch)
const hasExplicitBranch = computed(() => {
  if (props.card.useWorktree && props.card.worktreeName) return true;
  const config = sessionsStore.getSessionConfig(props.card.id);
  return !!config.gitBranch;
});

// Branch ahead/behind status
const branchStatus = ref<BranchStatus | null>(null);

async function refreshBranchStatus() {
  const project = projectsStore.activeProject;
  if (!project) return;

  // Use the effective project path (worktree-aware) as the repo root so git
  // resolves the correct HEAD even before the sidecar has sent its init message.
  const repoPath = effectiveProjectPath.value || project.path;

  // Prefer the worktree branch (from sidecar init), then the session-config git branch, then HEAD
  const config = sessionsStore.getSessionConfig(props.card.id);
  const branch = config.worktreeBranch
    || config.gitBranch
    || undefined;

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

function fileChipClass(label: string, filePath: string): string {
  if (isFileActive(label)) return 'file-chip--active';
  const status = fileStatuses.value[filePath];
  if (status === 'modified') return 'file-chip--modified';
  if (status === 'missing') return 'file-chip--missing';
  return '';
}

onMounted(() => { refreshBranchStatus(); refreshFileStatuses(); });

// Refresh whenever the card transitions back to idle (query just finished)
watch(() => props.card.state, (newState) => {
  if (newState === 'idle') { refreshBranchStatus(); refreshFileStatuses(); }
});

// Refresh file statuses when linked files change
watch(() => JSON.stringify(props.card.linkedFiles || {}), () => { refreshFileStatuses(); });

const showEdit = ref(false);
const showDeleteConfirm = ref(false);
const pendingDeleteCardId = ref<string | null>(null);

function formatTokens(n: number): string {
  if (!n || n < 1000) return String(n || 0);
  return `${(n / 1000).toFixed(1)}k`;
}

function formatCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
}

function openChat() { sessionsStore.openChat(props.card.id); }

async function openIssue(number: number) {
  if (!githubRepo.value) return;
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  openUrl(`https://github.com/${githubRepo.value}/issues/${number}`);
}

function handleEdit() {
  showEdit.value = true;
}

function handleFork() {
  emit('fork', props.card);
}

async function saveEdit(name: string, description: string, linkedFiles: Record<string, string>, linkedIssues: CardLinkedIssue[]) {
  showEdit.value = false;
  await cardsStore.updateCardInfo(props.card.id, name, description);
  await cardsStore.setCardLinkedFiles(props.card.id, linkedFiles);
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

// Meta zone visibility
const showMetaZone = computed(() => {
  return (branchStatus.value && hasExplicitBranch.value)
    || (props.card.linkedIssues?.length ?? 0) > 0
    || (props.card.costUsd ?? 0) > 0;
});
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
      :class="{ 'kanban-card--error': card.state === 'error' }"
      :data-card-id="card.id"
      @click="openChat"
    >
      <!-- Zone 1: Identity Bar -->
      <div class="zone-identity">
        <StatusIndicator :state="card.state" size="xs" />
        <span class="card-name">{{ card.name }}</span>
        <UDropdownMenu :items="menuItems">
          <UButton
            variant="ghost"
            color="neutral"
            size="xs"
            icon="i-lucide-ellipsis"
            class="menu-trigger"
            @click.stop
          />
        </UDropdownMenu>
      </div>

      <!-- Zone 2: Description -->
      <div v-if="card.description" class="zone-description">
        {{ card.description }}
      </div>

      <!-- Zone 3: Linked Files -->
      <div v-if="linkedFilesEntries.length > 0" class="zone-files">
        <span
          v-for="[label, filePath] in linkedFilesEntries"
          :key="label"
          class="file-chip"
          :class="[fileChipClass(label, String(filePath))]"
          :title="String(filePath)"
          @click.stop="onFileClick($event, label, String(filePath))"
        >
          {{ label }}<span v-if="fileStatuses[String(filePath)] === 'modified'" class="file-chip-dot"> ●</span>
        </span>
      </div>

      <!-- Zone 4: Meta Line -->
      <div v-if="showMetaZone" class="zone-meta">
        <div class="meta-left">
          <template v-if="branchStatus && hasExplicitBranch">
            <UIcon name="i-lucide-git-branch" class="meta-branch-icon" />
            <span class="meta-branch">{{ branchStatus.branch }}</span>
            <span v-if="branchStatus.ahead > 0" class="meta-ahead">&uarr;{{ branchStatus.ahead }}</span>
            <span v-if="branchStatus.behind > 0" class="meta-behind">&darr;{{ branchStatus.behind }}</span>
            <span v-if="branchStatus.ahead === 0 && branchStatus.behind === 0" class="meta-synced">&check;</span>
          </template>
          <template v-if="(card.linkedIssues?.length ?? 0) > 0">
            <span v-if="branchStatus && hasExplicitBranch" class="meta-sep">&middot;</span>
            <span
              v-for="issue in card.linkedIssues"
              :key="issue.number"
              class="meta-issue"
              :title="`#${issue.number}${issue.title ? ' ' + issue.title : ''}`"
              @click.stop="openIssue(issue.number)"
            >#{{ issue.number }}</span>
          </template>
        </div>
        <div v-if="card.costUsd && card.costUsd > 0" class="meta-right">
          <span>{{ formatCost(card.costUsd) }}</span>
          <span class="meta-sep">&middot;</span>
          <span>{{ formatTokens((card.inputTokens ?? 0) + (card.outputTokens ?? 0)) }}</span>
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
/* Card container */
.kanban-card {
  background: var(--bg-secondary);
  border: 1px solid var(--bg-tertiary);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  overflow: hidden;
  contain: layout paint;
  content-visibility: auto;
}
.kanban-card:hover { background: var(--bg-tertiary); }
.kanban-card--error { border-color: rgba(247, 118, 142, 0.3); }

/* Zone 1: Identity */
.zone-identity {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--bg-tertiary);
}
.card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.menu-trigger {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}
.kanban-card:hover .menu-trigger { opacity: 1; }

/* Zone 2: Description */
.zone-description {
  padding: 6px 12px;
  font-size: 11px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--bg-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Zone 3: Linked Files */
.zone-files {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--bg-tertiary);
}
.file-chip {
  background: rgba(122, 162, 247, 0.12);
  color: var(--accent);
  border: 1px solid rgba(122, 162, 247, 0.2);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  font-family: 'SF Mono', 'Fira Code', monospace;
}
.file-chip:hover {
  background: rgba(122, 162, 247, 0.2);
  border-color: rgba(122, 162, 247, 0.35);
}
.file-chip--active {
  background: rgba(122, 162, 247, 0.2);
  border-color: rgba(122, 162, 247, 0.4);
}
.file-chip--modified {
  background: rgba(224, 175, 104, 0.12);
  color: var(--warning);
  border-color: rgba(224, 175, 104, 0.2);
}
.file-chip--modified:hover {
  background: rgba(224, 175, 104, 0.2);
  border-color: rgba(224, 175, 104, 0.35);
}
.file-chip--missing {
  background: rgba(247, 118, 142, 0.12);
  color: var(--error);
  border-color: rgba(247, 118, 142, 0.2);
  text-decoration: line-through;
}
.file-chip--missing:hover {
  background: rgba(247, 118, 142, 0.2);
  border-color: rgba(247, 118, 142, 0.35);
}
.file-chip-dot { font-size: 8px; }

/* Zone 4: Meta */
.zone-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  font-size: 10px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: var(--text-muted);
}
.meta-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}
.meta-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.meta-branch-icon { width: 12px; height: 12px; color: var(--text-muted); flex-shrink: 0; }
.meta-branch {
  color: var(--text-secondary);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta-ahead { color: #4ade80; font-weight: 600; }
.meta-behind { color: #f87171; font-weight: 600; }
.meta-synced { color: var(--text-muted); }
.meta-sep { color: var(--bg-tertiary); }
.meta-issue {
  color: var(--accent);
  font-weight: 600;
  cursor: pointer;
}
.meta-issue:hover { opacity: 0.8; }
</style>
