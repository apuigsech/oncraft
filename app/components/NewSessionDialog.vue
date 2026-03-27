<script setup lang="ts">
import type { CardLinkedIssue, GitHubIssue } from '~/types';
import type { TabsItem } from '@nuxt/ui'

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

const tabItems: TabsItem[] = [
  { label: 'Blank', value: 'blank' },
  { label: 'From Issue', value: 'issue' }
]

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
  <UModal v-model:open="open" title="New Session" :ui="{ content: 'sm:max-w-[440px]', footer: 'justify-end' }" @update:open="(val: boolean) => { if (!val) cancel() }">
    <template #body>
      <div class="flex flex-col gap-4">
        <!-- Mode toggle (only when GitHub is configured) -->
        <UTabs
          v-if="githubRepo"
          v-model="mode"
          variant="pill"
          :items="tabItems"
          :content="false"
          class="w-full"
        />

        <!-- Issue selector (From Issue mode) -->
        <div v-if="mode === 'issue' && githubRepo" class="flex flex-col gap-2">
          <IssueSelector :repo="githubRepo" single @select="onIssueSelect" />
          <div v-if="linkedIssue" class="issue-selected">
            <span class="issue-selected-tag">#{{ linkedIssue.number }}</span>
            <span class="issue-selected-title">{{ linkedIssue.title }}</span>
          </div>
        </div>

        <UFormField label="Name">
          <UInput v-model="name" class="w-full" placeholder="e.g. Auth Feature" autofocus @keydown.enter="submit" />
        </UFormField>
        <UFormField label="Description (optional)">
          <UTextarea v-model="description" :rows="3" placeholder="Brief description..." class="w-full" />
        </UFormField>
        <div class="flex items-center justify-between">
          <span class="text-sm text-[var(--text-secondary)]">Create git worktree</span>
          <USwitch v-model="useWorktree" />
        </div>
      </div>
    </template>
    <template #footer>
      <UButton variant="ghost" color="neutral" @click="cancel">Cancel</UButton>
      <UButton :disabled="!name.trim()" @click="submit">Create</UButton>
    </template>
  </UModal>
</template>

<style scoped>
.issue-selected { display: flex; align-items: center; gap: 6px; padding: 6px 8px; background: rgba(99, 102, 241, 0.08); border: 1px solid var(--accent); border-radius: 4px; }
.issue-selected-tag { font-size: 12px; font-weight: 600; color: var(--accent); font-family: 'SF Mono', 'Fira Code', monospace; }
.issue-selected-title { font-size: 12px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
