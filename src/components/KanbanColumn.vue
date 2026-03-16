<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import type { Card, ColumnConfig } from '../types';
import { useCardsStore } from '../stores/cards';
import { useProjectsStore } from '../stores/projects';
import { useSessionsStore } from '../stores/sessions';
import { usePipelinesStore } from '../stores/pipelines';
import { resolveTemplate } from '../services/template-engine';
import KanbanCard from './KanbanCard.vue';
import NewSessionDialog from './NewSessionDialog.vue';
import ImportSessionsDialog from './ImportSessionsDialog.vue';

const props = defineProps<{ column: ColumnConfig }>();
const cardsStore = useCardsStore();
const projectsStore = useProjectsStore();
const sessionsStore = useSessionsStore();
const pipelinesStore = usePipelinesStore();

const showNewDialog = ref(false);
const showImportDialog = ref(false);

// Store-derived computed (read-only) for watching changes
const storeCards = computed(() => cardsStore.cardsByColumn(props.column.name));

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
  const fromColumnName = evt.from.dataset.columnName;
  const toColumnName = evt.to.dataset.columnName;

  if (!fromColumnName || !toColumnName) return;

  const card = evt.data;
  const newIndex = evt.newIndex ?? 0;

  if (!card) return;

  syncing = true;
  try {
    if (fromColumnName !== toColumnName) {
      await cardsStore.moveCard(card.id, toColumnName, newIndex);

      // Pipeline trigger
      const project = projectsStore.activeProject;
      if (project) {
        const pipeline = pipelinesStore.findPipeline(project.path, fromColumnName, toColumnName);
        if (pipeline) {
          const prompt = resolveTemplate(pipeline.prompt, {
            session: { name: card.name, id: card.sessionId },
            project: { path: project.path, name: project.name },
            card: { description: card.description },
            column: { from: fromColumnName, to: toColumnName },
          });
          sessionsStore.send(card.id, prompt);
          sessionsStore.openChat(card.id);
        }
      }
    } else {
      await cardsStore.applyColumnOrder(props.column.name, dragCards.value);
    }
  } finally {
    dragCards.value = [...storeCards.value];
    syncing = false;
  }
}

async function createSession(name: string, description: string, useWorktree: boolean) {
  showNewDialog.value = false;
  const project = projectsStore.activeProject;
  if (!project) return;
  const card = await cardsStore.addCard(project.id, props.column.name, name, description, { useWorktree });
  sessionsStore.openChat(card.id);
}
</script>

<template>
  <div class="kanban-column">
    <div class="column-header">
      <div class="column-title">
        <span class="color-dot" :style="{ background: column.color }" />
        <span>{{ column.name }}</span>
        <span class="card-count">{{ dragCards.length }}</span>
      </div>
      <div class="header-actions">
        <button class="action-btn" @click="showImportDialog = true" title="Import existing sessions">&#8615;</button>
        <button class="action-btn" @click="showNewDialog = true" title="New session">+</button>
      </div>
    </div>
    <VueDraggable
      v-model="dragCards"
      group="kanban"
      :animation="150"
      ghost-class="ghost"
      handle=".drag-handle"
      draggable=".kanban-card"
      :force-fallback="true"
      :data-column-name="column.name"
      class="column-body"
      @end="onDragEnd"
    >
      <KanbanCard
        v-for="card in dragCards"
        :key="card.id"
        :card="card"
        :column-color="column.color"
      />
    </VueDraggable>
    <NewSessionDialog v-if="showNewDialog" @create="createSession" @cancel="showNewDialog = false" />
    <ImportSessionsDialog
      v-if="showImportDialog && projectsStore.activeProject"
      :project-id="projectsStore.activeProject.id"
      :project-path="projectsStore.activeProject.path"
      :column-name="column.name"
      @close="showImportDialog = false"
    />
  </div>
</template>

<style scoped>
.kanban-column {
  min-width: 260px; max-width: 300px; flex-shrink: 0;
  display: flex; flex-direction: column; background: var(--bg-primary);
  border-radius: 8px; border: 1px solid var(--bg-tertiary); height: 100%;
}
.column-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--bg-tertiary); }
.column-title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
.color-dot { width: 10px; height: 10px; border-radius: 50%; }
.card-count { font-size: 11px; color: var(--text-muted); font-weight: 400; }
.header-actions { display: flex; gap: 2px; }
.action-btn { font-size: 16px; color: var(--text-muted); padding: 0 5px; border-radius: 4px; }
.action-btn:hover { background: var(--bg-tertiary); color: var(--text-primary); }
.column-body { flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; min-height: 100px; }
.ghost { opacity: 0.4; }
</style>
