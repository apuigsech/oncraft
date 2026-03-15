<script setup lang="ts">
import { ref } from 'vue';
import type { ColumnConfig } from '../types';

const props = defineProps<{ columns: ColumnConfig[] }>();
const emit = defineEmits<{
  update: [columns: ColumnConfig[]];
  'column-removed': [name: string];
  'column-renamed': [oldName: string, newName: string];
}>();

const localColumns = ref<ColumnConfig[]>([...props.columns]);

function addColumn() {
  localColumns.value.push({ name: 'New Column', color: '#94a3b8' });
  emit('update', localColumns.value);
}

function removeColumn(index: number) {
  if (!confirm(`Delete column "${localColumns.value[index].name}"? Cards will be migrated.`)) return;
  const colName = localColumns.value[index].name;
  localColumns.value.splice(index, 1);
  emit('update', localColumns.value);
  emit('column-removed', colName);
}

function updateColumn(index: number, field: keyof ColumnConfig, value: string) {
  const oldName = localColumns.value[index].name;
  localColumns.value[index] = { ...localColumns.value[index], [field]: value };
  emit('update', localColumns.value);
  if (field === 'name' && oldName !== value) {
    emit('column-renamed', oldName, value);
  }
}
</script>

<template>
  <div class="column-editor">
    <h4>Columns</h4>
    <div v-for="(col, i) in localColumns" :key="i" class="column-row">
      <input type="color" :value="col.color" @input="updateColumn(i, 'color', ($event.target as HTMLInputElement).value)" />
      <input :value="col.name" @input="updateColumn(i, 'name', ($event.target as HTMLInputElement).value)" />
      <button @click="removeColumn(i)" class="remove-btn">x</button>
    </div>
    <button class="add-column-btn" @click="addColumn">+ Add Column</button>
  </div>
</template>

<style scoped>
.column-editor { display: flex; flex-direction: column; gap: 8px; }
h4 { font-size: 14px; color: var(--text-primary); }
.column-row { display: flex; gap: 8px; align-items: center; }
.column-row input[type="color"] { width: 32px; height: 32px; border: none; border-radius: 4px; cursor: pointer; }
.column-row input[type="text"], .column-row input:not([type]) {
  flex: 1; background: var(--bg-primary); border: 1px solid var(--border);
  border-radius: 4px; padding: 6px 8px; font-size: 13px;
}
.remove-btn { color: var(--error); font-size: 14px; padding: 4px 8px; border-radius: 4px; }
.remove-btn:hover { background: rgba(239, 68, 68, 0.1); }
.add-column-btn { color: var(--accent); font-size: 13px; padding: 6px; border-radius: 4px; text-align: left; }
.add-column-btn:hover { background: var(--bg-tertiary); }
</style>
