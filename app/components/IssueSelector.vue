<script setup lang="ts">
import type { CardLinkedIssue, GitHubIssue } from '~/types';
import { listIssues, getIssue } from '~/services/github';

const props = defineProps<{
  repo: string;
  single?: boolean; // single-select mode for "create from issue"
}>();
const model = defineModel<CardLinkedIssue[]>({ default: () => [] });
const emit = defineEmits<{
  select: [issue: GitHubIssue]; // emitted in single mode when an issue is picked
}>();

const search = ref('');
const issues = ref<GitHubIssue[]>([]);
const loading = ref(false);
const error = ref('');
const open = ref(false);

let debounceTimer: ReturnType<typeof setTimeout> | undefined;

async function fetchIssues(query?: string) {
  loading.value = true;
  error.value = '';
  try {
    issues.value = await listIssues(props.repo, query || undefined);
  } catch (e: any) {
    error.value = e?.message || 'Failed to fetch issues';
    issues.value = [];
  } finally {
    loading.value = false;
  }
}

function onSearchInput() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    fetchIssues(search.value || undefined);
  }, 300);
}

function isLinked(issue: GitHubIssue): boolean {
  return model.value.some(i => i.number === issue.number);
}

async function selectIssue(issue: GitHubIssue) {
  if (props.single) {
    // In single mode, fetch full issue (with body) and emit
    try {
      const full = await getIssue(props.repo, issue.number);
      emit('select', full);
    } catch {
      emit('select', issue);
    }
    open.value = false;
    return;
  }

  // Multi-select toggle
  if (isLinked(issue)) {
    model.value = model.value.filter(i => i.number !== issue.number);
  } else {
    model.value = [...model.value, { number: issue.number, title: issue.title }];
  }
}

function removeIssue(number: number) {
  model.value = model.value.filter(i => i.number !== number);
}

function toggleDropdown() {
  open.value = !open.value;
  if (open.value && issues.value.length === 0) {
    fetchIssues();
  }
}

// Filter locally for immediate results
const filteredIssues = computed(() => {
  if (!search.value) return issues.value;
  const q = search.value.toLowerCase();
  return issues.value.filter(
    i => i.title.toLowerCase().includes(q) || String(i.number).includes(q)
  );
});
</script>

<template>
  <div class="issue-selector">
    <!-- Selected issues (multi mode) -->
    <div v-if="!single && model.length > 0" class="selected-issues">
      <div v-for="issue in model" :key="issue.number" class="issue-chip">
        <span class="issue-chip-number">#{{ issue.number }}</span>
        <span v-if="issue.title" class="issue-chip-title">{{ issue.title }}</span>
        <button class="issue-chip-remove" @click="removeIssue(issue.number)">&times;</button>
      </div>
    </div>

    <!-- Dropdown trigger -->
    <button class="selector-trigger" @click="toggleDropdown">
      <span class="trigger-text">{{ single ? 'Select an issue...' : 'Add issue...' }}</span>
      <span class="trigger-arrow">{{ open ? '▲' : '▼' }}</span>
    </button>

    <!-- Dropdown -->
    <div v-if="open" class="selector-dropdown">
      <input
        v-model="search"
        class="selector-search"
        placeholder="Search issues..."
        autofocus
        @input="onSearchInput"
        @keydown.escape="open = false"
      />

      <div class="selector-list">
        <div v-if="loading" class="selector-status">Loading...</div>
        <div v-else-if="error" class="selector-error">
          {{ error }}
          <button class="retry-btn" @click="fetchIssues()">Retry</button>
        </div>
        <div v-else-if="filteredIssues.length === 0" class="selector-status">No issues found</div>
        <button
          v-for="issue in filteredIssues"
          v-else
          :key="issue.number"
          class="selector-item"
          :class="{ 'is-linked': isLinked(issue) }"
          @click="selectIssue(issue)"
        >
          <span class="item-number">#{{ issue.number }}</span>
          <span class="item-title">{{ issue.title }}</span>
          <div v-if="issue.labels.length > 0" class="item-labels">
            <span v-for="label in issue.labels.slice(0, 3)" :key="label" class="item-label">{{ label }}</span>
          </div>
          <span v-if="!single && isLinked(issue)" class="item-check">✓</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.issue-selector { position: relative; }

.selected-issues { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.issue-chip { display: flex; align-items: center; gap: 4px; background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: 4px; padding: 2px 6px; font-size: 12px; }
.issue-chip-number { color: var(--accent); font-weight: 600; font-family: 'SF Mono', 'Fira Code', monospace; }
.issue-chip-title { color: var(--text-secondary); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.issue-chip-remove { color: var(--text-muted); font-size: 14px; padding: 0 2px; border-radius: 2px; line-height: 1; }
.issue-chip-remove:hover { color: var(--error); }

.selector-trigger { display: flex; justify-content: space-between; align-items: center; width: 100%; background: var(--bg-primary); border: 1px solid var(--border); border-radius: 4px; padding: 6px 8px; font-size: 12px; color: var(--text-muted); cursor: pointer; }
.selector-trigger:hover { border-color: var(--accent); }
.trigger-arrow { font-size: 10px; }

.selector-dropdown { position: absolute; top: 100%; left: 0; right: 0; z-index: 50; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; margin-top: 4px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); max-height: 280px; display: flex; flex-direction: column; }

.selector-search { background: var(--bg-primary); border: none; border-bottom: 1px solid var(--border); border-radius: 6px 6px 0 0; padding: 8px 10px; font-size: 12px; color: var(--text-primary); outline: none; }

.selector-list { overflow-y: auto; flex: 1; }

.selector-item { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 10px; font-size: 12px; text-align: left; cursor: pointer; border: none; background: none; color: var(--text-primary); }
.selector-item:hover { background: var(--bg-tertiary); }
.selector-item.is-linked { background: rgba(99, 102, 241, 0.08); }

.item-number { color: var(--accent); font-weight: 600; font-family: 'SF Mono', 'Fira Code', monospace; flex-shrink: 0; min-width: 40px; }
.item-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-labels { display: flex; gap: 3px; flex-shrink: 0; }
.item-label { font-size: 10px; padding: 1px 5px; border-radius: 8px; background: var(--bg-tertiary); color: var(--text-muted); }
.item-check { color: var(--success); font-weight: 600; flex-shrink: 0; }

.selector-status { padding: 12px; text-align: center; font-size: 12px; color: var(--text-muted); }
.selector-error { padding: 12px; text-align: center; font-size: 12px; color: var(--error); }
.retry-btn { font-size: 11px; color: var(--accent); margin-left: 6px; text-decoration: underline; }
</style>
