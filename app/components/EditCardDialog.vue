<script setup lang="ts">
import type { CardLinkedIssue } from '~/types';

const props = defineProps<{
  name: string;
  description: string;
  linkedFiles?: Record<string, string>;
  linkedIssues?: CardLinkedIssue[];
  githubRepo?: string;
}>();
const emit = defineEmits<{
  save: [name: string, description: string, linkedFiles: Record<string, string>, linkedIssues: CardLinkedIssue[]];
  cancel: [];
}>();

const editName = ref(props.name);
const editDesc = ref(props.description);

// Linked files as editable array of { label, path } entries
const fileEntries = ref<{ label: string; path: string }[]>(
  Object.entries(props.linkedFiles || {}).map(([label, path]) => ({ label, path }))
);

function addFileEntry() {
  fileEntries.value.push({ label: '', path: '' });
}

function removeFileEntry(index: number) {
  fileEntries.value.splice(index, 1);
}

// Linked issues
const issueEntries = ref<CardLinkedIssue[]>(
  (props.linkedIssues || []).map(i => ({ ...i }))
);
const newIssueNumber = ref('');

function addIssue() {
  const num = parseInt(newIssueNumber.value, 10);
  if (!num || num <= 0) return;
  if (issueEntries.value.some(i => i.number === num)) return;
  issueEntries.value.push({ number: num });
  newIssueNumber.value = '';
}

function removeIssue(index: number) {
  issueEntries.value.splice(index, 1);
}

function save() {
  if (!editName.value.trim()) return;
  // Convert file entries back to Record
  const files: Record<string, string> = {};
  for (const entry of fileEntries.value) {
    const label = entry.label.trim();
    const path = entry.path.trim();
    if (label && path) files[label] = path;
  }
  emit('save', editName.value.trim(), editDesc.value.trim(), files, issueEntries.value);
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

        <!-- Linked Files -->
        <div class="section">
          <div class="section-header">
            <span class="section-label">Linked Files</span>
            <button class="add-btn" @click="addFileEntry">+ Add</button>
          </div>
          <div v-for="(entry, i) in fileEntries" :key="i" class="file-row">
            <input
              v-model="entry.label"
              class="file-label-input"
              placeholder="label (e.g. plan)"
            />
            <input
              v-model="entry.path"
              class="file-path-input"
              placeholder="path (e.g. docs/plan.md)"
            />
            <button class="remove-btn" @click="removeFileEntry(i)">&times;</button>
          </div>
          <span v-if="fileEntries.length === 0" class="empty-hint">No files linked</span>
        </div>

        <!-- Linked Issues (only if GitHub is configured) -->
        <div v-if="githubRepo" class="section">
          <div class="section-header">
            <span class="section-label">GitHub Issues</span>
            <span class="section-repo">{{ githubRepo }}</span>
          </div>
          <div class="issue-add-row">
            <span class="issue-hash">#</span>
            <input
              v-model="newIssueNumber"
              type="number"
              min="1"
              class="issue-number-input"
              placeholder="issue number"
              @keydown.enter="addIssue"
            />
            <button class="add-btn" :disabled="!newIssueNumber" @click="addIssue">Add</button>
          </div>
          <div v-for="(issue, i) in issueEntries" :key="issue.number" class="issue-row">
            <span class="issue-tag">#{{ issue.number }}</span>
            <span v-if="issue.title" class="issue-title">{{ issue.title }}</span>
            <button class="remove-btn" @click="removeIssue(i)">&times;</button>
          </div>
          <span v-if="issueEntries.length === 0" class="empty-hint">No issues linked</span>
        </div>
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
.dialog { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 20px; width: 420px; max-height: 80vh; display: flex; flex-direction: column; gap: 12px; }
.dialog-header { display: flex; justify-content: space-between; align-items: center; }
.dialog-header h3 { font-size: 16px; }
.close-btn { font-size: 18px; color: var(--text-muted); padding: 2px 6px; border-radius: 4px; }
.close-btn:hover { background: var(--bg-tertiary); }
.dialog-body { display: flex; flex-direction: column; gap: 12px; overflow-y: auto; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-secondary); }
input, textarea { background: var(--bg-primary); border: 1px solid var(--border); border-radius: 4px; padding: 8px; font-size: 13px; font-family: inherit; color: var(--text-primary); }
input:focus, textarea:focus { outline: none; border-color: var(--accent); }
textarea { resize: vertical; }

.section { display: flex; flex-direction: column; gap: 6px; }
.section-header { display: flex; justify-content: space-between; align-items: center; }
.section-label { font-size: 12px; color: var(--text-secondary); font-weight: 600; }
.section-repo { font-size: 11px; color: var(--text-muted); font-family: 'SF Mono', 'Fira Code', monospace; }

.file-row { display: flex; gap: 6px; align-items: center; }
.file-label-input { width: 90px; flex-shrink: 0; font-size: 12px; padding: 5px 7px; font-family: 'SF Mono', 'Fira Code', monospace; }
.file-path-input { flex: 1; font-size: 12px; padding: 5px 7px; font-family: 'SF Mono', 'Fira Code', monospace; }

.issue-add-row { display: flex; gap: 6px; align-items: center; }
.issue-hash { color: var(--text-muted); font-size: 13px; font-weight: 600; }
.issue-number-input { width: 100px; font-size: 12px; padding: 5px 7px; }
.issue-number-input::-webkit-inner-spin-button,
.issue-number-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.issue-number-input[type=number] { -moz-appearance: textfield; }

.issue-row { display: flex; gap: 6px; align-items: center; }
.issue-tag { font-size: 12px; font-weight: 600; color: var(--accent); font-family: 'SF Mono', 'Fira Code', monospace; }
.issue-title { font-size: 12px; color: var(--text-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.add-btn { font-size: 12px; color: var(--accent); padding: 3px 8px; border-radius: 4px; }
.add-btn:hover:not(:disabled) { background: var(--bg-tertiary); }
.add-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.remove-btn { font-size: 14px; color: var(--text-muted); padding: 2px 6px; border-radius: 4px; flex-shrink: 0; }
.remove-btn:hover { color: var(--error); background: rgba(239, 68, 68, 0.1); }
.empty-hint { font-size: 11px; color: var(--text-muted); }

.dialog-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.btn-primary { background: var(--accent); color: white; padding: 6px 16px; border-radius: 4px; font-size: 13px; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-secondary { padding: 6px 16px; border-radius: 4px; font-size: 13px; color: var(--text-secondary); }
.btn-secondary:hover { background: var(--bg-tertiary); }
</style>
