<script setup lang="ts">
import type { CardLinkedIssue } from '~/types';

const props = defineProps<{
  name: string;
  description: string;
  linkedFiles?: Record<string, string>;
  linkedIssues?: CardLinkedIssue[];
  githubRepo?: string;
  projectPath?: string;
}>();

const open = defineModel<boolean>('open', { default: true });

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
  open.value = false;
}

function cancel() {
  emit('cancel');
  open.value = false;
}
</script>

<template>
  <UModal v-model:open="open" title="Edit Card" :ui="{ width: 'sm:max-w-[420px]' }" @update:open="(val: boolean) => { if (!val) cancel() }">
    <template #body>
      <div class="flex flex-col gap-3">
        <UFormField label="Title">
          <UInput v-model="editName" autofocus @keydown.enter="save" />
        </UFormField>
        <UFormField label="Description">
          <UTextarea v-model="editDesc" :rows="3" placeholder="Optional description..." />
        </UFormField>

        <!-- Linked Files -->
        <div class="section">
          <div class="section-header">
            <span class="section-label">Linked Files</span>
            <UButton variant="ghost" color="primary" size="xs" @click="addFileEntry">+ Add</UButton>
          </div>
          <div v-for="(entry, i) in fileEntries" :key="i" class="file-row">
            <UInput
              v-model="entry.label"
              size="xs"
              class="file-label-input"
              placeholder="label (e.g. plan)"
            />
            <FilePickerInput
              v-model="entry.path"
              :project-path="props.projectPath || ''"
              class="file-path-input"
            />
            <UButton variant="ghost" color="error" size="xs" icon="i-lucide-x" @click="removeFileEntry(i)" />
          </div>
          <span v-if="fileEntries.length === 0" class="empty-hint">No files linked</span>
        </div>

        <!-- Linked Issues (only if GitHub is configured) -->
        <div v-if="githubRepo" class="section">
          <div class="section-header">
            <span class="section-label">GitHub Issues</span>
            <span class="section-repo">{{ githubRepo }}</span>
          </div>
          <IssueSelector :repo="githubRepo" v-model="issueEntries" />
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton variant="ghost" color="neutral" @click="cancel">Cancel</UButton>
        <UButton :disabled="!editName.trim()" @click="save">Save</UButton>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.section { display: flex; flex-direction: column; gap: 6px; }
.section-header { display: flex; justify-content: space-between; align-items: center; }
.section-label { font-size: 12px; color: var(--text-secondary); font-weight: 600; }
.section-repo { font-size: 11px; color: var(--text-muted); font-family: 'SF Mono', 'Fira Code', monospace; }

.file-row { display: flex; gap: 6px; align-items: center; }
.file-label-input { width: 90px; flex-shrink: 0; font-family: 'SF Mono', 'Fira Code', monospace; }
.file-path-input { flex: 1; font-family: 'SF Mono', 'Fira Code', monospace; }
.empty-hint { font-size: 11px; color: var(--text-muted); }
</style>
