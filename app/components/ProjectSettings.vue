<script setup lang="ts">
import type { ColumnConfig, PipelineConfig } from '~/types';

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
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog">
      <div class="dialog-header">
        <h3>Project Settings</h3>
        <button class="close-btn" @click="emit('close')">&times;</button>
      </div>
      <div class="dialog-body">
        <div v-if="project" class="settings-content">
          <div class="field">
            <span class="field-label">Project Path</span>
            <span class="field-value mono">{{ project.path }}</span>
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
      </div>
      <div class="dialog-footer">
        <button class="btn-secondary" @click="emit('close')">Close</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
.dialog { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; width: 500px; max-height: 80vh; display: flex; flex-direction: column; }
.dialog-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--border); }
.dialog-header h3 { font-size: 16px; }
.close-btn { font-size: 18px; color: var(--text-muted); padding: 2px 6px; border-radius: 4px; }
.close-btn:hover { background: var(--bg-tertiary); }
.dialog-body { flex: 1; overflow-y: auto; padding: 18px; }
.settings-content { display: flex; flex-direction: column; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
.field-value { font-size: 13px; color: var(--text-secondary); }
.mono { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; background: var(--bg-primary); padding: 4px 8px; border-radius: 4px; }
.dialog-footer { display: flex; justify-content: flex-end; padding: 12px 18px; border-top: 1px solid var(--border); }
.btn-secondary { padding: 6px 16px; border-radius: 4px; font-size: 13px; color: var(--text-secondary); }
.btn-secondary:hover { background: var(--bg-tertiary); }
</style>
