<script setup lang="ts">
import { computed } from 'vue';
import { useProjectsStore } from '../stores/projects';
import { usePipelinesStore } from '../stores/pipelines';
import { useCardsStore } from '../stores/cards';
import type { ColumnConfig, PipelineConfig } from '../types';
import ColumnEditor from './ColumnEditor.vue';
import PipelineEditor from './PipelineEditor.vue';

const emit = defineEmits<{ close: [] }>();
const projectsStore = useProjectsStore();
const pipelinesStore = usePipelinesStore();
const cardsStore = useCardsStore();

const project = computed(() => projectsStore.activeProject);
const config = computed(() => {
  if (!project.value) return null;
  return pipelinesStore.getConfig(project.value.path) || null;
});

async function onColumnsUpdate(columns: ColumnConfig[]) {
  if (!project.value || !config.value) return;
  await pipelinesStore.saveConfig(project.value.path, { ...config.value, columns });
}

async function onColumnRemoved(removedName: string) {
  if (!project.value || !config.value) return;
  const targetColumn = config.value.columns[0]?.name;
  if (targetColumn) {
    const affectedCards = cardsStore.cards.filter(c => c.columnName === removedName);
    for (const card of affectedCards) {
      await cardsStore.moveCard(card.id, targetColumn, 0);
    }
  }
  const pipelines = config.value.pipelines.filter(p => p.from !== removedName && p.to !== removedName);
  await pipelinesStore.saveConfig(project.value.path, { ...config.value, pipelines });
}

async function onColumnRenamed(oldName: string, newName: string) {
  if (!project.value || !config.value) return;
  const pipelines = config.value.pipelines.map(p => ({
    ...p,
    from: p.from === oldName ? newName : p.from,
    to: p.to === oldName ? newName : p.to,
  }));
  await pipelinesStore.saveConfig(project.value.path, { ...config.value, pipelines });
  const affectedCards = cardsStore.cards.filter(c => c.columnName === oldName);
  for (const card of affectedCards) { await cardsStore.moveCard(card.id, newName, card.columnOrder); }
}

async function onPipelinesUpdate(pipelines: PipelineConfig[]) {
  if (!project.value || !config.value) return;
  await pipelinesStore.saveConfig(project.value.path, { ...config.value, pipelines });
}
</script>

<template>
  <UModal
    :model-value="true"
    @update:model-value="emit('close')"
    title="Project Settings"
    :ui="{ content: 'max-h-[80vh] overflow-y-auto' }"
  >
    <template #body>
      <div v-if="project" class="flex flex-col gap-5">
        <div class="flex flex-col gap-1">
          <p class="text-xs text-muted uppercase tracking-wide">Project Path</p>
          <UBadge variant="soft" color="neutral" class="font-mono text-xs">{{ project.path }}</UBadge>
        </div>
        <ColumnEditor
          v-if="config"
          :columns="config.columns"
          @update="onColumnsUpdate"
          @column-removed="onColumnRemoved"
          @column-renamed="onColumnRenamed"
        />
        <PipelineEditor
          v-if="config"
          :pipelines="config.pipelines"
          :columns="config.columns"
          @update="onPipelinesUpdate"
        />
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end">
        <UButton variant="ghost" @click="emit('close')">Close</UButton>
      </div>
    </template>
  </UModal>
</template>
