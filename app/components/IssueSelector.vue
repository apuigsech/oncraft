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
const triggerEl = ref<InstanceType<typeof UButton> | null>(null);
const dropdownStyle = ref<Record<string, string>>({});

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
    try {
      const full = await getIssue(props.repo, issue.number);
      emit('select', full);
    } catch {
      emit('select', issue);
    }
    open.value = false;
    return;
  }

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
  if (open.value) {
    updateDropdownPosition();
    if (issues.value.length === 0) fetchIssues();
  }
}

function updateDropdownPosition() {
  if (!triggerEl.value) return;
  const el = triggerEl.value.$el as HTMLElement | undefined;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  dropdownStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 4}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
  };
}

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
        <UButton variant="ghost" color="error" size="xs" icon="i-lucide-x" class="issue-chip-remove" @click="removeIssue(issue.number)" />
      </div>
    </div>

    <!-- Dropdown trigger -->
    <UButton ref="triggerEl" variant="outline" color="neutral" size="sm" block class="selector-trigger" @click="toggleDropdown">
      <span class="trigger-text">{{ single ? 'Select an issue...' : 'Add issue...' }}</span>
      <template #trailing>
        <UIcon :name="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" />
      </template>
    </UButton>

    <!-- Dropdown (teleported to body to avoid clipping) -->
    <Teleport to="body">
      <div v-if="open" class="selector-dropdown" :style="dropdownStyle">
        <UInput
          v-model="search"
          placeholder="Search issues..."
          size="sm"
          autofocus
          class="selector-search"
          @input="onSearchInput"
          @keydown.escape="open = false"
        />

        <div class="selector-list">
          <div v-if="loading" class="selector-status">Loading...</div>
          <div v-else-if="error" class="selector-error">
            {{ error }}
            <UButton variant="link" color="primary" size="xs" @click="fetchIssues()">Retry</UButton>
          </div>
          <div v-else-if="filteredIssues.length === 0" class="selector-status">No issues found</div>
          <template v-else>
            <UButton
              v-for="issue in filteredIssues"
              :key="issue.number"
              variant="ghost"
              color="neutral"
              block
              size="sm"
              class="selector-item"
              :class="{ 'is-linked': isLinked(issue) }"
              @click="selectIssue(issue)"
            >
              <span class="item-number">#{{ issue.number }}</span>
              <span class="item-title">{{ issue.title }}</span>
              <div v-if="issue.labels.length > 0" class="item-labels">
                <span v-for="label in issue.labels.slice(0, 3)" :key="label" class="item-label">{{ label }}</span>
              </div>
              <span v-if="!single && isLinked(issue)" class="item-check">&check;</span>
            </UButton>
          </template>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.issue-selector { position: relative; }

.selected-issues { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.issue-chip { display: flex; align-items: center; gap: 4px; background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: 4px; padding: 2px 6px; font-size: 12px; }
.issue-chip-number { color: var(--accent); font-weight: 600; font-family: 'SF Mono', 'Fira Code', monospace; }
.issue-chip-title { color: var(--text-secondary); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.issue-chip-remove { padding: 0 !important; min-height: auto !important; height: auto !important; }

.selector-trigger { justify-content: space-between !important; }
.trigger-text { font-size: 12px; color: var(--text-muted); }
</style>

<style>
/* Unscoped because the dropdown is teleported to body */
.selector-dropdown { z-index: 200; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); max-height: 280px; display: flex; flex-direction: column; }
.selector-search { border-radius: 6px 6px 0 0; }
.selector-list { overflow-y: auto; flex: 1; }
.selector-item { justify-content: flex-start !important; gap: 6px; text-align: left; border-radius: 0 !important; }
.selector-item.is-linked { background: rgba(99, 102, 241, 0.08); }
.item-number { color: var(--accent); font-weight: 600; font-family: 'SF Mono', 'Fira Code', monospace; flex-shrink: 0; min-width: 40px; }
.item-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item-labels { display: flex; gap: 3px; flex-shrink: 0; }
.item-label { font-size: 10px; padding: 1px 5px; border-radius: 8px; background: var(--bg-tertiary); color: var(--text-muted); }
.item-check { color: var(--success); font-weight: 600; flex-shrink: 0; }
.selector-status { padding: 12px; text-align: center; font-size: 12px; color: var(--text-muted); }
.selector-error { padding: 12px; text-align: center; font-size: 12px; color: var(--error); }
</style>
