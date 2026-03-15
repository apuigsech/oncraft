<script setup lang="ts">
import { ref, computed } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import type { ColumnConfig, Card } from '../types';
import { useCardsStore } from '../stores/cards';
import { useProjectsStore } from '../stores/projects';
import { useSessionsStore } from '../stores/sessions';
import { usePipelinesStore } from '../stores/pipelines';
import { resolveTemplate } from '../services/template-engine';
import KanbanCard from './KanbanCard.vue';
import NewSessionDialog from './NewSessionDialog.vue';

const props = defineProps<{ column: ColumnConfig }>();
const cardsStore = useCardsStore();
const projectsStore = useProjectsStore();
const sessionsStore = useSessionsStore();
const pipelinesStore = usePipelinesStore();

const showNewDialog = ref(false);

// Writable computed for VueDraggable v-model compatibility.
// Reads from store; writes are handled by event handlers (onAdd, onUpdate).
const columnCards = computed<Card[]>({
  get: () => cardsStore.cardsByColumn(props.column.name),
  set: () => {
    // Mutations handled via onAdd / onUpdate event handlers below.
  },
});

async function onAdd(evt: { newIndex?: number }) {
  // After VueDraggable moves the item into columnCards, find the card at the new index
  const newIdx = evt.newIndex ?? 0;
  const card = columnCards.value[newIdx];
  if (!card) return;
  const fromColumn = card.columnName;
  await cardsStore.moveCard(card.id, props.column.name, newIdx);

  const project = projectsStore.activeProject;
  if (!project) return;
  const pipeline = pipelinesStore.findPipeline(project.path, fromColumn, props.column.name);
  if (pipeline) {
    if (card.state === 'idle' && card.sessionId) {
      await sessionsStore.resumeSession(card.id, card.sessionId, project.path);
    } else if (!card.sessionId) {
      await sessionsStore.startSession(card.id, project.path);
    }
    const prompt = resolveTemplate(pipeline.prompt, {
      session: { name: card.name, id: card.sessionId },
      project: { path: project.path, name: project.name },
      card: { description: card.description },
      column: { from: fromColumn, to: props.column.name },
    });
    await sessionsStore.send(card.id, prompt);
    sessionsStore.openChat(card.id);
  }
}

async function onUpdate() {
  const ids = columnCards.value.map(c => c.id);
  await cardsStore.reorderColumn(props.column.name, ids);
}

async function createSession(name: string, description: string) {
  showNewDialog.value = false;
  const project = projectsStore.activeProject;
  if (!project) return;
  const card = await cardsStore.addCard(project.id, props.column.name, name, description);
  await sessionsStore.startSession(card.id, project.path);
  sessionsStore.openChat(card.id);
}
</script>

<template>
  <div class="kanban-column">
    <div class="column-header">
      <div class="column-title">
        <span class="color-dot" :style="{ background: column.color }" />
        <span>{{ column.name }}</span>
        <span class="card-count">{{ columnCards.length }}</span>
      </div>
      <button class="add-btn" @click="showNewDialog = true" title="New session">+</button>
    </div>
    <VueDraggable
      v-model="columnCards"
      :animation="150"
      ghost-class="ghost"
      group="kanban"
      class="column-body"
      @add="onAdd"
      @update="onUpdate"
    >
      <KanbanCard
        v-for="card in columnCards"
        :key="card.id"
        :card="card"
        :column-color="column.color"
      />
    </VueDraggable>
    <NewSessionDialog v-if="showNewDialog" @create="createSession" @cancel="showNewDialog = false" />
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
.add-btn { font-size: 18px; color: var(--text-muted); padding: 0 4px; border-radius: 4px; }
.add-btn:hover { background: var(--bg-tertiary); color: var(--text-primary); }
.column-body { flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; min-height: 100px; }
.ghost { opacity: 0.4; }
</style>
