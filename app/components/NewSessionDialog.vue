<script setup lang="ts">
import type { CardLinkedIssue, GitHubIssue } from '~/types';

const props = defineProps<{
  initialName?: string;
  initialDescription?: string;
  githubRepo?: string;
}>();

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
        <!-- Mode toggle (only when GitHub is configured) -->
        <div v-if="githubRepo" class="mode-toggle">
          <button
            class="mode-btn"
            :class="{ active: mode === 'blank' }"
            @click="mode = 'blank'"
          >Blank</button>
          <button
            class="mode-btn"
            :class="{ active: mode === 'issue' }"
            @click="mode = 'issue'"
          >From Issue</button>
        </div>

        <!-- Issue selector (From Issue mode) -->
        <div v-if="mode === 'issue' && githubRepo" class="issue-section">
          <IssueSelector :repo="githubRepo" single @select="onIssueSelect" />
          <div v-if="linkedIssue" class="issue-selected">
            <span class="issue-selected-tag">#{{ linkedIssue.number }}</span>
            <span class="issue-selected-title">{{ linkedIssue.title }}</span>
          </div>
        </div>

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

.mode-toggle { display: flex; gap: 0; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.mode-btn { flex: 1; padding: 6px 12px; font-size: 12px; background: var(--bg-primary); color: var(--text-muted); border: none; cursor: pointer; transition: all 0.15s; }
.mode-btn:not(:last-child) { border-right: 1px solid var(--border); }
.mode-btn.active { background: var(--accent); color: white; }
.mode-btn:hover:not(.active) { background: var(--bg-tertiary); }

.issue-section { display: flex; flex-direction: column; gap: 8px; }
.issue-selected { display: flex; align-items: center; gap: 6px; padding: 6px 8px; background: rgba(99, 102, 241, 0.08); border: 1px solid var(--accent); border-radius: 4px; }
.issue-selected-tag { font-size: 12px; font-weight: 600; color: var(--accent); font-family: 'SF Mono', 'Fira Code', monospace; }
.issue-selected-title { font-size: 12px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
