<script setup lang="ts">

const props = defineProps<{
  initialName?: string;
  initialDescription?: string;
}>();

const emit = defineEmits<{ create: [name: string, description: string, useWorktree: boolean]; cancel: [] }>();
const name = ref(props.initialName || '');
const description = ref(props.initialDescription || '');
const useWorktree = ref(false);

function submit() {
  if (!name.value.trim()) return;
  emit('create', name.value.trim(), description.value.trim(), useWorktree.value);
  name.value = '';
  description.value = '';
  useWorktree.value = false;
}
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('cancel')">
    <div class="dialog">
      <div class="dialog-header">
        <h3>New Session</h3>
        <button class="close-btn" @click="emit('cancel')">&times;</button>
      </div>
      <div class="dialog-body">
        <label>
          Name
          <input v-model="name" placeholder="e.g. Auth Feature" autofocus @keydown.enter="submit" />
        </label>
        <label>
          Description (optional)
          <input v-model="description" placeholder="Brief description..." @keydown.enter="submit" />
        </label>
        <label class="worktree-option">
          <input type="checkbox" v-model="useWorktree" />
          <span>Isolated workspace (git worktree)</span>
        </label>
      </div>
      <div class="dialog-footer">
        <button class="btn-secondary" @click="emit('cancel')">Cancel</button>
        <button class="btn-primary" :disabled="!name.trim()" @click="submit">Create</button>
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
input { background: var(--bg-primary); border: 1px solid var(--border); border-radius: 4px; padding: 8px; font-size: 13px; font-family: inherit; color: var(--text-primary); }
input:focus { outline: none; border-color: var(--accent); }
.dialog-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.btn-primary { background: var(--accent); color: white; padding: 6px 16px; border-radius: 4px; font-size: 13px; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary { padding: 6px 16px; border-radius: 4px; font-size: 13px; color: var(--text-secondary); }
.btn-secondary:hover { background: var(--bg-tertiary); }
.worktree-option { flex-direction: row; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; color: var(--text-secondary); }
.worktree-option input[type="checkbox"] { width: 14px; height: 14px; accent-color: var(--accent); }
</style>
