<script setup lang="ts">
import { VueDraggable } from 'vue-draggable-plus';
import type { ColumnConfig } from '~/types';

const props = defineProps<{ columns: ColumnConfig[] }>();
const emit = defineEmits<{
  update: [columns: ColumnConfig[]];
  'column-removed': [name: string];
  'column-renamed': [oldName: string, newName: string];
}>();

const localColumns = ref<ColumnConfig[]>(props.columns.map(c => ({ ...c })));
const expandedIndex = ref<number | null>(null);

function toggleExpand(index: number) {
  expandedIndex.value = expandedIndex.value === index ? null : index;
}

function addColumn() {
  localColumns.value.push({ name: 'New Column', color: '#94a3b8', inputs: [], outputs: [] });
  emit('update', localColumns.value);
}

function onDragUpdate() {
  // VueDraggable has already mutated localColumns via v-model at this point
  expandedIndex.value = null;
  emit('update', [...localColumns.value]);
}

function removeColumn(index: number) {
  if (!confirm(`Delete column "${localColumns.value[index].name}"? Cards will be migrated.`)) return;
  const colName = localColumns.value[index].name;
  if (expandedIndex.value === index) expandedIndex.value = null;
  else if (expandedIndex.value !== null && expandedIndex.value > index) expandedIndex.value--;
  localColumns.value.splice(index, 1);
  emit('update', localColumns.value);
  emit('column-removed', colName);
}

function updateColumn(index: number, field: keyof ColumnConfig, value: unknown) {
  const oldName = localColumns.value[index].name;
  localColumns.value[index] = { ...localColumns.value[index], [field]: value };
  emit('update', localColumns.value);
  if (field === 'name' && oldName !== value) {
    emit('column-renamed', oldName, value as string);
  }
}

// --- Tag helpers for inputs/outputs ---
const newInputText = ref<Record<number, string>>({});
const newOutputText = ref<Record<number, string>>({});

function addTag(index: number, field: 'inputs' | 'outputs', textMap: Ref<Record<number, string>>) {
  const text = (textMap.value[index] || '').trim();
  if (!text) return;
  const current = [...(localColumns.value[index][field] || [])];
  if (!current.includes(text)) {
    current.push(text);
    updateColumn(index, field, current);
  }
  textMap.value[index] = '';
}

function removeTag(index: number, field: 'inputs' | 'outputs', tagIndex: number) {
  const current = [...(localColumns.value[index][field] || [])];
  current.splice(tagIndex, 1);
  updateColumn(index, field, current);
}
</script>

<template>
  <div class="column-editor">
    <h4>Columns</h4>
    <VueDraggable
      v-model="localColumns"
      handle=".drag-handle"
      :animation="150"
      ghost-class="ghost"
      :force-fallback="true"
      @update="onDragUpdate"
    >
      <div v-for="(col, i) in localColumns" :key="col.name" class="column-block">
        <div class="column-row">
          <span class="drag-handle" title="Drag to reorder">⠿</span>
          <input type="color" :value="col.color" @input="updateColumn(i, 'color', ($event.target as HTMLInputElement).value)" />
          <input :value="col.name" @input="updateColumn(i, 'name', ($event.target as HTMLInputElement).value)" />
          <button class="expand-btn" @click="toggleExpand(i)" :title="expandedIndex === i ? 'Collapse workflow' : 'Edit workflow'">
            <span :class="{ rotated: expandedIndex === i }">▶</span>
          </button>
          <button @click="removeColumn(i)" class="remove-btn">x</button>
        </div>

        <!-- Expanded workflow fields -->
        <div v-if="expandedIndex === i" class="workflow-fields">
          <!-- Inputs -->
          <div class="tag-section">
            <label class="tag-label">Inputs</label>
            <div class="tag-list">
              <span v-for="(tag, ti) in (col.inputs || [])" :key="ti" class="tag">
                {{ tag }}
                <button class="tag-remove" @click="removeTag(i, 'inputs', ti)">&times;</button>
              </span>
            </div>
            <div class="tag-input-row">
              <input
                v-model="newInputText[i]"
                placeholder="Add input..."
                @keydown.enter.prevent="addTag(i, 'inputs', newInputText)"
              />
              <button class="tag-add-btn" @click="addTag(i, 'inputs', newInputText)">+</button>
            </div>
          </div>

          <!-- Outputs -->
          <div class="tag-section">
            <label class="tag-label">Outputs</label>
            <div class="tag-list">
              <span v-for="(tag, ti) in (col.outputs || [])" :key="ti" class="tag">
                {{ tag }}
                <button class="tag-remove" @click="removeTag(i, 'outputs', ti)">&times;</button>
              </span>
            </div>
            <div class="tag-input-row">
              <input
                v-model="newOutputText[i]"
                placeholder="Add output..."
                @keydown.enter.prevent="addTag(i, 'outputs', newOutputText)"
              />
              <button class="tag-add-btn" @click="addTag(i, 'outputs', newOutputText)">+</button>
            </div>
          </div>

          <!-- Prompt -->
          <div class="prompt-section">
            <label class="tag-label">Column Prompt</label>
            <textarea
              :value="col.prompt || ''"
              @input="updateColumn(i, 'prompt', ($event.target as HTMLTextAreaElement).value)"
              placeholder="System prompt for sessions in this column..."
              rows="4"
            />
            <span class="variable-hint">
              Variables: <code v-pre>{{session.name}}</code> <code v-pre>{{project.name}}</code>
              <code v-pre>{{card.description}}</code> <code v-pre>{{column.name}}</code>
            </span>
          </div>
        </div>
      </div>
    </VueDraggable>
    <button class="add-column-btn" @click="addColumn">+ Add Column</button>
  </div>
</template>

<style scoped>
.column-editor { display: flex; flex-direction: column; gap: 8px; }
h4 { font-size: 14px; color: var(--text-primary); }
.column-block { display: flex; flex-direction: column; gap: 0; }
.column-row { display: flex; gap: 8px; align-items: center; }
.drag-handle {
  cursor: grab; color: var(--text-muted); font-size: 14px;
  user-select: none; padding: 2px 2px; letter-spacing: 1px;
}
.drag-handle:active { cursor: grabbing; }
.column-row input[type="color"] { width: 32px; height: 32px; border: none; border-radius: 4px; cursor: pointer; }
.column-row input[type="text"], .column-row input:not([type]) {
  flex: 1; background: var(--bg-primary); border: 1px solid var(--border);
  border-radius: 4px; padding: 6px 8px; font-size: 13px;
}
.expand-btn {
  color: var(--text-muted); font-size: 10px; padding: 4px 6px; border-radius: 4px;
  transition: transform 0.15s;
}
.expand-btn:hover { background: var(--bg-tertiary); }
.expand-btn .rotated { display: inline-block; transform: rotate(90deg); }
.remove-btn { color: var(--error); font-size: 14px; padding: 4px 8px; border-radius: 4px; }
.remove-btn:hover { background: rgba(239, 68, 68, 0.1); }
.add-column-btn { color: var(--accent); font-size: 13px; padding: 6px; border-radius: 4px; text-align: left; }
.add-column-btn:hover { background: var(--bg-tertiary); }
.ghost { opacity: 0.4; }

/* Workflow expanded fields */
.workflow-fields {
  margin: 6px 0 10px 40px;
  padding: 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  display: flex; flex-direction: column; gap: 10px;
}
.tag-section, .prompt-section { display: flex; flex-direction: column; gap: 4px; }
.tag-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
.tag-list { display: flex; flex-wrap: wrap; gap: 4px; }
.tag {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--bg-tertiary); border-radius: 4px;
  padding: 2px 8px; font-size: 12px; color: var(--text-secondary);
}
.tag-remove { font-size: 12px; color: var(--text-muted); padding: 0 2px; line-height: 1; }
.tag-remove:hover { color: var(--error); }
.tag-input-row { display: flex; gap: 4px; }
.tag-input-row input {
  flex: 1; background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: 4px; padding: 4px 8px; font-size: 12px; color: var(--text-primary);
}
.tag-add-btn {
  color: var(--accent); font-size: 14px; padding: 2px 8px; border-radius: 4px;
}
.tag-add-btn:hover { background: var(--bg-tertiary); }
.prompt-section textarea {
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: 4px; padding: 6px 8px; font-size: 12px; color: var(--text-primary);
  resize: vertical; font-family: 'SF Mono', 'Fira Code', monospace;
}
.variable-hint { font-size: 10px; color: var(--text-muted); }
.variable-hint code {
  background: var(--bg-tertiary); padding: 1px 4px; border-radius: 2px; font-size: 10px;
}
</style>
