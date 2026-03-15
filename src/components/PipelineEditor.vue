<script setup lang="ts">
import { ref } from 'vue';
import type { PipelineConfig, ColumnConfig } from '../types';

const props = defineProps<{ pipelines: PipelineConfig[]; columns: ColumnConfig[] }>();
const emit = defineEmits<{ update: [pipelines: PipelineConfig[]] }>();
const localPipelines = ref<PipelineConfig[]>([...props.pipelines]);

const variableNames = [
  'session.name', 'session.id', 'project.path',
  'project.name', 'card.description', 'column.from', 'column.to',
];

function formatVar(v: string): string {
  return '\u007B\u007B' + v + '\u007D\u007D';
}

function addPipeline() {
  const cols = props.columns;
  localPipelines.value.push({ from: cols[0]?.name || '', to: cols[1]?.name || '', prompt: '' });
  emit('update', localPipelines.value);
}

function removePipeline(index: number) {
  localPipelines.value.splice(index, 1);
  emit('update', localPipelines.value);
}

function updatePipeline(index: number, field: keyof PipelineConfig, value: string) {
  localPipelines.value[index] = { ...localPipelines.value[index], [field]: value };
  emit('update', localPipelines.value);
}
</script>

<template>
  <div class="pipeline-editor">
    <h4>Pipelines</h4>
    <div v-for="(p, i) in localPipelines" :key="i" class="pipeline-row">
      <div class="transition-row">
        <select :value="p.from" @change="updatePipeline(i, 'from', ($event.target as HTMLSelectElement).value)">
          <option v-for="col in columns" :key="col.name" :value="col.name">{{ col.name }}</option>
        </select>
        <span class="arrow">-&gt;</span>
        <select :value="p.to" @change="updatePipeline(i, 'to', ($event.target as HTMLSelectElement).value)">
          <option v-for="col in columns" :key="col.name" :value="col.name">{{ col.name }}</option>
        </select>
        <button @click="removePipeline(i)" class="remove-btn">x</button>
      </div>
      <textarea :value="p.prompt" @input="updatePipeline(i, 'prompt', ($event.target as HTMLTextAreaElement).value)"
        placeholder="Prompt template... Use variables like session.name, project.path, etc." rows="3" />
    </div>
    <button class="add-pipeline-btn" @click="addPipeline">+ Add Pipeline</button>
    <div class="variables-help">
      <span class="label">Variables:</span>
      <code v-for="v in variableNames" :key="v">{{ formatVar(v) }}</code>
    </div>
  </div>
</template>

<style scoped>
.pipeline-editor { display: flex; flex-direction: column; gap: 12px; }
h4 { font-size: 14px; color: var(--text-primary); }
.pipeline-row { display: flex; flex-direction: column; gap: 6px; padding: 10px; background: var(--bg-primary); border-radius: 6px; border: 1px solid var(--bg-tertiary); }
.transition-row { display: flex; align-items: center; gap: 8px; }
.arrow { color: var(--text-muted); font-size: 12px; }
select { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 4px; padding: 4px 8px; font-size: 12px; color: var(--text-primary); }
textarea { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 4px; padding: 8px; font-size: 12px; font-family: monospace; resize: vertical; color: var(--text-primary); }
textarea:focus { outline: none; border-color: var(--accent); }
.remove-btn { color: var(--error); font-size: 14px; padding: 4px 8px; margin-left: auto; }
.add-pipeline-btn { color: var(--accent); font-size: 13px; padding: 6px; text-align: left; }
.add-pipeline-btn:hover { background: var(--bg-tertiary); border-radius: 4px; }
.variables-help { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 11px; color: var(--text-muted); }
.variables-help code { background: var(--bg-tertiary); padding: 1px 6px; border-radius: 3px; font-size: 10px; }
.label { margin-right: 4px; }
</style>
