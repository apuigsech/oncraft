<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ name: string; description: string }>();
const emit = defineEmits<{ save: [name: string, description: string]; cancel: [] }>();

const editName = ref(props.name);
const editDesc = ref(props.description);

function save() {
  if (!editName.value.trim()) return;
  emit('save', editName.value.trim(), editDesc.value.trim());
}
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('cancel')">
    <div class="dialog">
      <div class="dialog-header">
        <h3>Edit Card</h3>
        <button class="close-btn" @click="emit('cancel')">&times;</button>
      </div>
      <div class="dialog-body">
        <label>
          Title
          <input v-model="editName" autofocus @keydown.enter="save" />
        </label>
        <label>
          Description
          <textarea v-model="editDesc" rows="3" placeholder="Optional description..." />
        </label>
      </div>
      <div class="dialog-footer">
        <button class="btn-secondary" @click="emit('cancel')">Cancel</button>
        <button class="btn-primary" :disabled="!editName.trim()" @click="save">Save</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
.dialog { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 20px; width: 360px; display: flex; flex-direction: column; gap: 12px; }
.dialog-header { display: flex; justify-content: space-between; align-items: center; }
.dialog-header h3 { font-size: 16px; }
.close-btn { font-size: 18px; color: var(--text-muted); padding: 2px 6px; border-radius: 4px; }
.close-btn:hover { background: var(--bg-tertiary); }
.dialog-body { display: flex; flex-direction: column; gap: 12px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-secondary); }
input, textarea { background: var(--bg-primary); border: 1px solid var(--border); border-radius: 4px; padding: 8px; font-size: 13px; font-family: inherit; color: var(--text-primary); }
input:focus, textarea:focus { outline: none; border-color: var(--accent); }
textarea { resize: vertical; }
.dialog-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.btn-primary { background: var(--accent); color: white; padding: 6px 16px; border-radius: 4px; font-size: 13px; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary { padding: 6px 16px; border-radius: 4px; font-size: 13px; color: var(--text-secondary); }
.btn-secondary:hover { background: var(--bg-tertiary); }
</style>
