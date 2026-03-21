<script setup lang="ts">
import { VueDraggable } from 'vue-draggable-plus';
import type { Card } from '~/types';

const flowStore = useFlowStore();
const cardsStore = useCardsStore();

// Columns from Flow stateOrder — each is a FlowState with slug, name, color
const columns = computed(() =>
  flowStore.stateOrder.map(slug => flowStore.getFlowState(slug)).filter(Boolean)
);

// Orphaned cards: columnName slug not in stateOrder
const orphanedCards = ref<Card[]>([]);

// Keep orphanedCards in sync with store
const storeOrphaned = computed(() =>
  cardsStore.cards.filter(
    c => !c.archived && !flowStore.stateOrder.includes(c.columnName)
  )
);
let syncing = false;
watch(storeOrphaned, (newCards) => {
  if (syncing) return;
  orphanedCards.value = [...newCards];
}, { immediate: true, deep: true });

async function onOrphanDragEnd(evt: { from: HTMLElement; to: HTMLElement; oldIndex?: number; newIndex?: number; data: Card }) {
  const toSlug = evt.to.dataset.columnName;
  if (!toSlug || toSlug === '_unknown') return;

  const card = evt.data;
  const newIndex = evt.newIndex ?? 0;
  if (!card) return;

  syncing = true;
  try {
    await cardsStore.moveCard(card.id, toSlug, newIndex);
  } finally {
    orphanedCards.value = [...storeOrphaned.value];
    syncing = false;
  }
}
</script>

<template>
  <div class="kanban-board">
    <KanbanColumn
      v-for="state in columns"
      :key="state!.slug"
      :flow-state="state!"
    />
    <!-- Ghost column for orphaned cards whose slug no longer exists in the Flow -->
    <div v-if="orphanedCards.length" class="kanban-column column-unknown">
      <div class="column-header">
        <div class="column-title">
          <UIcon name="i-lucide-alert-triangle" class="text-yellow-400" />
          <span>Unknown Column</span>
          <UBadge variant="soft" color="neutral" size="sm">{{ orphanedCards.length }}</UBadge>
        </div>
      </div>
      <VueDraggable
        v-model="orphanedCards"
        group="kanban"
        :animation="150"
        ghost-class="ghost"
        draggable=".kanban-card"
        :force-fallback="true"
        :delay="60"
        data-column-name="_unknown"
        class="column-body"
        @end="onOrphanDragEnd"
      >
        <p class="unknown-hint">These cards reference a column that no longer exists. Drag them to a valid column.</p>
        <KanbanCard
          v-for="card in orphanedCards"
          :key="card.id"
          :card="card"
          column-color="#6b7280"
        />
      </VueDraggable>
    </div>
  </div>
</template>

<style scoped>
.kanban-board { display: flex; gap: 12px; padding: 16px; height: 100%; overflow-x: auto; align-items: stretch; }
.column-unknown { min-width: 260px; max-width: 300px; flex-shrink: 0; display: flex; flex-direction: column; background: var(--bg-primary); border-radius: 8px; border: 1px solid rgba(234, 179, 8, 0.4); height: 100%; }
.column-body { flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; min-height: 100px; }
.unknown-hint { font-size: 11px; color: var(--text-muted); padding: 4px 2px; }
</style>
