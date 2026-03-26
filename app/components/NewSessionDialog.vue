<script setup lang="ts">
import type { CardLinkedIssue, GitHubIssue } from '~/types';

const props = defineProps<{
  initialName?: string;
  initialDescription?: string;
  githubRepo?: string;
}>();

const open = defineModel<boolean>('open', { default: true });

const emit = defineEmits<{
  create: [name: string, description: string, useWorktree: boolean, linkedIssues?: CardLinkedIssue[]];
  cancel: [];
}>();
const name = ref(props.initialName || '');
const description = ref(props.initialDescription || '');
const useWorktree = ref(false);
const mode = ref<'blank' | 'issue'>('blank');
const linkedIssue = ref<CardLinkedIssue | undefined>(undefined);

function onIssueSelect(issue: GitHubIssue) {
  name.value = issue.title;
  description.value = (issue.body || '').slice(0, 500);
  linkedIssue.value = { number: issue.number, title: issue.title };
}

function submit() {
  if (!name.value.trim()) return;
  const issues = linkedIssue.value ? [linkedIssue.value] : undefined;
  emit('create', name.value.trim(), description.value.trim(), useWorktree.value, issues);
  name.value = '';
  description.value = '';
  useWorktree.value = false;
  linkedIssue.value = undefined;
  mode.value = 'blank';
  open.value = false;
}

function cancel() {
  emit('cancel');
  open.value = false;
}
</script>

<template>
  <UModal v-model:open="open" title="New Session" :ui="{ width: 'sm:max-w-[360px]' }" @update:open="(val: boolean) => { if (!val) cancel() }">
    <template #body>
      <div class="flex flex-col gap-3">
        <!-- Mode toggle (only when GitHub is configured) -->
        <div v-if="githubRepo" class="mode-toggle">
          <UButton
            :variant="mode === 'blank' ? 'solid' : 'ghost'"
            :color="mode === 'blank' ? 'primary' : 'neutral'"
            size="xs"
            class="flex-1"
            @click="mode = 'blank'"
          >Blank</UButton>
          <UButton
            :variant="mode === 'issue' ? 'solid' : 'ghost'"
            :color="mode === 'issue' ? 'primary' : 'neutral'"
            size="xs"
            class="flex-1"
            @click="mode = 'issue'"
          >From Issue</UButton>
        </div>

        <!-- Issue selector (From Issue mode) -->
        <div v-if="mode === 'issue' && githubRepo" class="flex flex-col gap-2">
          <IssueSelector :repo="githubRepo" single @select="onIssueSelect" />
          <div v-if="linkedIssue" class="issue-selected">
            <span class="issue-selected-tag">#{{ linkedIssue.number }}</span>
            <span class="issue-selected-title">{{ linkedIssue.title }}</span>
          </div>
        </div>

        <UFormField label="Name">
          <UInput v-model="name" placeholder="e.g. Auth Feature" autofocus @keydown.enter="submit" />
        </UFormField>
        <UFormField label="Description (optional)">
          <UInput v-model="description" placeholder="Brief description..." @keydown.enter="submit" />
        </UFormField>
        <UCheckbox v-model="useWorktree" label="Isolated workspace (git worktree)" />
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton variant="ghost" color="neutral" @click="cancel">Cancel</UButton>
        <UButton :disabled="!name.trim()" @click="submit">Create</UButton>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.mode-toggle { display: flex; gap: 0; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }

.issue-selected { display: flex; align-items: center; gap: 6px; padding: 6px 8px; background: rgba(99, 102, 241, 0.08); border: 1px solid var(--accent); border-radius: 4px; }
.issue-selected-tag { font-size: 12px; font-weight: 600; color: var(--accent); font-family: 'SF Mono', 'Fira Code', monospace; }
.issue-selected-title { font-size: 12px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
