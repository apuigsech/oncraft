<script setup lang="ts">
import { ref, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import type { ColumnConfig, Card } from '../types';
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

// Mutable local list for VueDraggable
const localCards = ref<Card[]>([]);
let syncing = false;

// Sync store → local (but not while dragging)
watch(
  () => cardsStore.cardsByColumn(props.column.name),
  (storeCards) => {
    if (syncing) return;
    localCards.value = [...storeCards];
  },
  { immediate: true },
);

// When VueDraggable modifies localCards (via v-model), persist to store
async function onEnd() {
  // After any drag operation ends, sync local state to store
  syncing = true;

  // Find cards that were added to this column (their columnName doesn't match)
  for (let i = 0; i < localCards.value.length; i++) {
    const card = localCards.value[i];
    if (card.columnName !== props.column.name) {
      const fromColumn = card.columnName;
      await cardsStore.moveCard(card.id, props.column.name, i);

      // Trigger pipeline if configured
      const project = projectsStore.activeProject;
      if (project) {
        const pipeline = pipelinesStore.findPipeline(project.path, fromColumn, props.column.name);
        if (pipeline) {
          const prompt = resolveTemplate(pipeline.prompt, {
            session: { name: card.name, id: card.sessionId },
            project: { path: project.path, name: project.name },
            card: { description: card.description },
            column: { from: fromColumn, to: props.column.name },
          });
          sessionsStore.send(card.id, prompt);
          sessionsStore.openChat(card.id);
        }
      }
    }
  }

  // Update order for all cards in this column
  const ids = localCards.value.map(c => c.id);
  await cardsStore.reorderColumn(props.column.name, ids);

  syncing = false;
}

async function createSession(name: string, description: string) {
  showNewDialog.value = false;
  const project = projectsStore.activeProject;
  if (!project) return;
  const card = await cardsStore.addCard(project.id, props.column.name, name, description);
  sessionsStore.openChat(card.id);
}
</script>

<template>
  <div class="kanban-column">
    <div class="column-header">
      <div class="column-title">
        <span class="color-dot" :style="{ background: column.color }" />
        <span>{{ column.name }}</span>
        <span class="card-count">{{ localCards.length }}</span>
      </div>
      <div class="header-actions">
        <button class="action-btn" @click="showImportDialog = true" title="Import existing sessions">&#8615;</button>
        <button class="action-btn" @click="showNewDialog = true" title="New session">+</button>
      </div>
    </div>
    <VueDraggable
      v-model="localCards"
      :animation="150"
      ghost-class="ghost"
      group="kanban"
      class="column-body"
      @end="onEnd"
    >
      <KanbanCard
        v-for="card in localCards"
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
