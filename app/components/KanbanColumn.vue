<script setup lang="ts">
import { VueDraggable } from 'vue-draggable-plus';
import type { Card, FlowState } from '~/types';

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

// Warnings for this state's configuration
const warnings = computed(() => flowStore.stateWarnings(props.flowState.slug));

// Store-derived computed — use slug (stable identifier) to match card.columnName
const storeCards = computed(() => cardsStore.cardsByColumn(props.flowState.slug));

// Local mutable ref that vue-draggable-plus can freely mutate during drag
const dragCards = ref<Card[]>([...storeCards.value]);

// Track whether we're mid-drag to avoid the watch reverting draggable's DOM changes
let syncing = false;

// Sync store -> local ref when store changes externally (card added, archived, etc.)
watch(storeCards, (newCards) => {
  if (syncing) return;
  dragCards.value = [...newCards];
}, { deep: true });

async function onDragEnd(evt: { from: HTMLElement; to: HTMLElement; oldIndex?: number; newIndex?: number; data: Card }) {
  const fromSlug = evt.from.dataset.columnName;
  const toSlug   = evt.to.dataset.columnName;

  if (!fromSlug || !toSlug) return;

  const card     = evt.data;
  const newIndex = evt.newIndex ?? 0;
  if (!card) return;

  // requiredFiles gate — check before allowing cross-column move
  if (fromSlug !== toSlug) {
    const missing = flowStore.checkRequiredFiles(toSlug, card.linkedFiles);
    if (missing.length > 0) {
      // Abort drag: revert DOM
      evt.from.appendChild(evt.to.children[newIndex] ?? evt.data as unknown as Node);
      missingFiles.value            = missing;
      showRequiredFilesDialog.value = true;
      dragCards.value = [...storeCards.value];
      return;
    }
  }

  syncing = true;
  try {
    if (fromSlug !== toSlug) {
      await cardsStore.moveCard(card.id, toSlug, newIndex);
      // Fire trigger prompt if the target state has one
      await sessionsStore.fireTriggerPrompt(card.id, toSlug);
    } else {
      await cardsStore.applyColumnOrder(props.flowState.slug, dragCards.value);
    }
  } finally {
    dragCards.value = [...storeCards.value];
    syncing = false;
  }
}

async function createSession(name: string, description: string, useWorktree: boolean) {
  showNewDialog.value = false;
  forkParent.value = null;
  const project = projectsStore.activeProject;
  if (!project) return;
  // Use slug (stable identifier) as columnName stored in DB
  const card = await cardsStore.addCard(project.id, props.flowState.slug, name, description, useWorktree);
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
        <span class="color-dot" :style="{ background: flowState.color }" />
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
        <button class="action-btn" @click="showImportDialog = true" title="Import existing sessions">
          <UIcon name="i-lucide-download" />
        </button>
        <button class="action-btn" @click="showNewDialog = true" title="New session">
          <UIcon name="i-lucide-plus" />
        </button>
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
      @end="onDragEnd"
    >
      <KanbanCard
        v-for="card in dragCards"
        :key="card.id"
        :card="card"
        :column-color="flowState.color"
        @fork="handleFork"
      />
    </VueDraggable>

    <!-- requiredFiles blocked-move dialog -->
    <div v-if="showRequiredFilesDialog" class="required-files-overlay" @click.self="showRequiredFilesDialog = false">
      <div class="required-files-dialog">
        <p class="required-files-title">Cannot move card — missing required files:</p>
        <ul class="required-files-list">
          <li v-for="f in missingFiles" :key="f"><code>{{ f }}</code></li>
        </ul>
        <p class="required-files-hint">Assign these linked file slots on the card before moving it here.</p>
        <button class="btn-close" @click="showRequiredFilesDialog = false">Close</button>
      </div>
    </div>

    <NewSessionDialog
      v-if="showNewDialog"
      :initial-name="forkParent?.name ? forkParent.name + ' (fork)' : undefined"
      :initial-description="forkParent?.description"
      @create="(n: string, d: string, w: boolean) => (forkParent ? createForkedSession : createSession)(n, d, w)"
      @cancel="showNewDialog = false; forkParent = null"
    />
    <ImportSessionsDialog
      v-if="showImportDialog && projectsStore.activeProject"
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
.warning-icon { font-size: 13px; color: #fbbf24; cursor: help; }
.header-actions { display: flex; gap: 2px; }
.action-btn {
  font-size: 16px;
  color: var(--text-muted);
  padding: 0 5px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.action-btn:hover { background: var(--bg-tertiary); color: var(--text-primary); }
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
.required-files-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center; z-index: 200;
}
.required-files-dialog {
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: 8px; padding: 20px; max-width: 360px; width: 100%;
}
.required-files-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
.required-files-list { margin: 0 0 8px 16px; font-size: 13px; }
.required-files-list li { margin-bottom: 4px; }
.required-files-hint { font-size: 12px; color: var(--text-muted); margin-bottom: 12px; }
.btn-close { padding: 6px 16px; border-radius: 4px; font-size: 13px; background: var(--bg-tertiary); color: var(--text-primary); }
</style>
