<script setup lang="ts">
import { VueDraggable } from 'vue-draggable-plus';
import type { Card, FlowState, CardLinkedIssue } from '~/types';
import { closeIssue } from '~/services/github';

const toast = useToast();

const props = defineProps<{ flowState: FlowState }>();
const cardsStore = useCardsStore();
const projectsStore = useProjectsStore();
const sessionsStore = useSessionsStore();
const flowStore = useFlowStore();

const showNewDialog = ref(false);
const showImportDialog = ref(false);
const forkParent = ref<Card | null>(null);
const missingFiles = ref<string[]>([]);
const showRequiredFilesDialog = ref(false);

// Close-on-Done dialog
const showCloseIssuesDialog = ref(false);
const closeIssuesCandidates = ref<(CardLinkedIssue & { checked: boolean })[]>([]);
const closingIssues = ref(false);

// Warnings for this state's configuration
const warnings = computed(() => flowStore.stateWarnings(props.flowState.slug));

// Store-derived computed — use slug (stable identifier) to match card.columnName
const storeCards = computed(() => cardsStore.cardsByColumn(props.flowState.slug));

// Local mutable ref that vue-draggable-plus can freely mutate during drag
const dragCards = ref<Card[]>([...storeCards.value]);

// Sync store -> local ref when store changes externally (card added, archived, etc.)
// Uses shared isDragging flag so ALL columns (source + destination) skip sync during drag
watch(storeCards, (newCards) => {
  if (cardsStore.isDragging) return;
  dragCards.value = [...newCards];
}, { deep: true });

// Capture the card being dragged at start (before onRemove mutates dragCards)
let draggedCard: Card | null = null;

function onDragStart(evt: { oldIndex?: number }) {
  cardsStore.isDragging = true;
  draggedCard = evt.oldIndex != null ? dragCards.value[evt.oldIndex] ?? null : null;
}

async function onDragEnd(evt: { from: HTMLElement; to: HTMLElement; oldIndex?: number; newIndex?: number }) {
  const fromSlug = evt.from.dataset.columnName;
  const toSlug   = evt.to.dataset.columnName;
  const card     = draggedCard;
  const newIndex = evt.newIndex ?? 0;
  draggedCard = null;

  if (!fromSlug || !toSlug || !card) {
    cardsStore.isDragging = false;
    dragCards.value = [...storeCards.value];
    return;
  }

  try {
    if (fromSlug !== toSlug) {
      const result = await cardsStore.moveCardToColumn(card.id, toSlug, newIndex);
      if (!result.success && result.missingFiles) {
        missingFiles.value            = result.missingFiles;
        showRequiredFilesDialog.value = true;
        return;
      }

      // Close-on-Done: if moved to last column and card has linked issues
      const lastSlug = flowStore.stateOrder[flowStore.stateOrder.length - 1];
      if (toSlug === lastSlug && card.linkedIssues?.length && flowStore.githubRepository) {
        closeIssuesCandidates.value = card.linkedIssues.map(i => ({ ...i, checked: true }));
        showCloseIssuesDialog.value = true;
      }
    } else {
      await cardsStore.applyColumnOrder(props.flowState.slug, dragCards.value);
    }
  } finally {
    cardsStore.isDragging = false;
    dragCards.value = [...storeCards.value];
    // vue-draggable-plus restores DOM nodes via insertBefore in onRemove,
    // but Vue's VDOM reconciliation may not clean them up. Force cleanup.
    nextTick(() => {
      for (const container of [evt.from, evt.to]) {
        if (!container) continue;
        const expected = new Set(
          cardsStore.cardsByColumn(container.dataset.columnName ?? '')
            .map(c => c.id)
        );
        container.querySelectorAll('.kanban-card').forEach(el => {
          const cardId = el.getAttribute('data-card-id');
          if (cardId && !expected.has(cardId)) el.remove();
        });
      }
    });
  }
}

async function confirmCloseIssues() {
  const repo = flowStore.githubRepository;
  if (!repo) return;
  closingIssues.value = true;
  const toClose = closeIssuesCandidates.value.filter(i => i.checked);
  for (const issue of toClose) {
    try {
      await closeIssue(repo, issue.number, 'Completed via OnCraft');
    } catch (err: any) {
      console.warn(`[OnCraft] Failed to close issue #${issue.number}:`, err);
      toast.add({ title: `Failed to close #${issue.number}`, description: err?.message || 'Unknown error', color: 'error' });
    }
  }
  closingIssues.value = false;
  showCloseIssuesDialog.value = false;
}

async function createSession(name: string, description: string, useWorktree: boolean, linkedIssues?: import('~/types').CardLinkedIssue[]) {
  showNewDialog.value = false;
  forkParent.value = null;
  const project = projectsStore.activeProject;
  if (!project) return;
  // Use slug (stable identifier) as columnName stored in DB
  const card = await cardsStore.addCard(project.id, props.flowState.slug, name, description, useWorktree, undefined, linkedIssues);
  if (useWorktree && card.worktreeName) {
    sessionsStore.updateSessionConfig(card.id, { worktreeName: card.worktreeName });
  }
  sessionsStore.openChat(card.id);
}

function handleFork(parentCard: Card) {
  forkParent.value = parentCard;
  showNewDialog.value = true;
}

async function createForkedSession(name: string, description: string, useWorktree: boolean) {
  showNewDialog.value = false;
  const parent = forkParent.value;
  forkParent.value = null;
  const project = projectsStore.activeProject;
  if (!project) return;
  const card = await cardsStore.addCard(
    project.id, props.flowState.slug, name, description, useWorktree,
    parent?.id,
  );
  if (useWorktree && card.worktreeName) {
    sessionsStore.updateSessionConfig(card.id, { worktreeName: card.worktreeName });
  }
  sessionsStore.openChat(card.id);
}
</script>

<template>
  <div class="kanban-column">
    <!-- Column header -->
    <div class="column-header">
      <div class="column-title">
        <UIcon v-if="flowState.icon" :name="flowState.icon" class="column-icon" :style="{ color: flowState.color }" />
        <span v-else class="color-dot" :style="{ background: flowState.color }" />
        <span>{{ flowState.name }}</span>
        <UBadge variant="soft" color="neutral" size="sm" class="card-count">
          {{ dragCards.length }}
        </UBadge>
        <!-- Configuration warnings badge -->
        <UTooltip v-if="warnings.length" :text="warnings.map(w => w.message).join('; ')">
          <UIcon name="i-lucide-alert-triangle" class="warning-icon" />
        </UTooltip>
      </div>
      <div class="header-actions">
        <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-download" title="Import existing sessions" @click="showImportDialog = true" />
        <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-plus" title="New session" @click="showNewDialog = true" />
      </div>
    </div>

    <!-- Cards with drag-and-drop -->
    <!-- data-column-name uses slug (stable DB identifier) -->
    <VueDraggable
      v-model="dragCards"
      group="kanban"
      :animation="150"
      ghost-class="ghost"
      draggable=".kanban-card"
      :force-fallback="true"
      :delay="60"
      :delay-on-touch-only="false"
      :data-column-name="flowState.slug"
      class="column-body"
      @start="onDragStart"
      @end="onDragEnd"
    >
      <KanbanCard
        v-for="card in dragCards"
        :key="card.id"
        :card="card"
        @fork="handleFork"
      />
    </VueDraggable>

    <!-- requiredFiles blocked-move dialog -->
    <UModal v-model:open="showRequiredFilesDialog" title="Cannot move card">
      <template #body>
        <p class="required-files-title">Missing required files:</p>
        <ul class="required-files-list">
          <li v-for="f in missingFiles" :key="f"><code>{{ f }}</code></li>
        </ul>
        <p class="required-files-hint">Assign these linked file slots on the card before moving it here.</p>
      </template>
      <template #footer>
        <div class="flex justify-end">
          <UButton variant="ghost" color="neutral" @click="showRequiredFilesDialog = false">Close</UButton>
        </div>
      </template>
    </UModal>

    <!-- Close Issues on Done dialog -->
    <UModal v-model:open="showCloseIssuesDialog" title="Close issues on GitHub?">
      <template #body>
        <div class="flex flex-col gap-2">
          <div
            v-for="issue in closeIssuesCandidates"
            :key="issue.number"
            class="close-issue-row"
            @click="issue.checked = !issue.checked"
          >
            <UCheckbox v-model="issue.checked" />
            <span class="close-issue-number">#{{ issue.number }}</span>
            <span v-if="issue.title" class="close-issue-title">{{ issue.title }}</span>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" color="neutral" @click="showCloseIssuesDialog = false">Skip</UButton>
          <UButton
            :disabled="closingIssues || !closeIssuesCandidates.some(i => i.checked)"
            :loading="closingIssues"
            @click="confirmCloseIssues"
          >{{ closingIssues ? 'Closing...' : 'Close selected' }}</UButton>
        </div>
      </template>
    </UModal>

    <NewSessionDialog
      v-if="showNewDialog"
      v-model:open="showNewDialog"
      :initial-name="forkParent?.name ? forkParent.name + ' (fork)' : undefined"
      :initial-description="forkParent?.description"
      :github-repo="flowStore.githubRepository"
      @create="(n: string, d: string, w: boolean, issues?: import('~/types').CardLinkedIssue[]) => (forkParent ? createForkedSession(n, d, w) : createSession(n, d, w, issues))"
      @cancel="showNewDialog = false; forkParent = null"
    />
    <ImportSessionsDialog
      v-if="showImportDialog && projectsStore.activeProject"
      v-model:open="showImportDialog"
      :project-id="projectsStore.activeProject.id"
      :project-path="projectsStore.activeProject.path"
      :column-name="flowState.slug"
      @close="showImportDialog = false"
    />
  </div>
</template>

<style scoped>
.kanban-column {
  min-width: 260px;
  max-width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border-radius: 8px;
  border: 1px solid var(--bg-tertiary);
  height: 100%;
}
.column-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid var(--bg-tertiary);
}
.column-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
}
.color-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.column-icon { font-size: 16px; flex-shrink: 0; }
.warning-icon { font-size: 13px; color: #fbbf24; cursor: help; }
.header-actions { display: flex; gap: 2px; }
.column-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 100px;
}
.ghost { opacity: 0.4; }

/* requiredFiles dialog */
.required-files-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
.required-files-list { margin: 0 0 8px 16px; font-size: 13px; }
.required-files-list li { margin-bottom: 4px; }
.required-files-hint { font-size: 12px; color: var(--text-muted); }

/* Close issues dialog */
.close-issue-row { display: flex; align-items: center; gap: 8px; cursor: pointer; padding: 4px 0; font-size: 13px; color: var(--text-primary); }
.close-issue-number { font-weight: 600; color: var(--accent); font-family: 'SF Mono', 'Fira Code', monospace; }
.close-issue-title { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
