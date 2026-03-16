<script setup lang="ts">
import type { ModelAlias, EffortLevel, PermissionMode } from '../types';

defineProps<{
  model: ModelAlias;
  effort: EffortLevel;
  permissionMode: PermissionMode;
  gitBranch?: string;
  worktreePath?: string;
  worktreeBranch?: string;
}>();

const emit = defineEmits<{
  'update:model': [value: ModelAlias];
  'update:effort': [value: EffortLevel];
  'update:permissionMode': [value: PermissionMode];
}>();

const EFFORT_OPTIONS: { value: EffortLevel; label: string }[] = [
  { value: 'low',    label: 'Lo'  },
  { value: 'medium', label: 'Med' },
  { value: 'high',   label: 'Hi'  },
  { value: 'max',    label: 'Max' },
];

const MODE_OPTIONS: { value: PermissionMode; label: string; icon: string }[] = [
  { value: 'default',           label: 'Default',   icon: 'i-lucide-lock'           },
  { value: 'acceptEdits',       label: 'Auto-edit', icon: 'i-lucide-pencil'         },
  { value: 'plan',              label: 'Plan',      icon: 'i-lucide-clipboard-list' },
  { value: 'bypassPermissions', label: 'YOLO',      icon: 'i-lucide-zap'            },
];

function modeColor(mode: PermissionMode): string {
  switch (mode) {
    case 'default': return 'var(--text-secondary)';
    case 'acceptEdits': return 'var(--success)';
    case 'plan': return 'var(--warning)';
    case 'bypassPermissions': return 'var(--error)';
  }
}
</script>

<template>
  <div class="input-toolbar">
    <div class="toolbar-left">
      <!-- Model selector -->
      <select
        :value="model"
        class="toolbar-select"
        @change="emit('update:model', ($event.target as HTMLSelectElement).value as ModelAlias)"
      >
        <option value="opus">Opus</option>
        <option value="sonnet">Sonnet</option>
        <option value="haiku">Haiku</option>
      </select>

      <!-- Effort level -->
      <div class="effort-group">
        <button
          v-for="opt in EFFORT_OPTIONS"
          :key="opt.value"
          class="effort-btn"
          :class="{ 'effort-btn--active': effort === opt.value }"
          :title="'Effort: ' + opt.value"
          @click="emit('update:effort', opt.value)"
        >{{ opt.label }}</button>
      </div>

      <!-- Permission mode -->
      <select
        :value="permissionMode"
        class="toolbar-select mode-select"
        :style="{ color: modeColor(permissionMode) }"
        @change="emit('update:permissionMode', ($event.target as HTMLSelectElement).value as PermissionMode)"
      >
        <option v-for="opt in MODE_OPTIONS" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
    </div>

    <div class="toolbar-right">
      <span
        v-if="worktreeBranch"
        class="worktree-info"
        :title="'Worktree: ' + (worktreePath || '')"
      >
        <UIcon name="i-lucide-git-branch" class="branch-icon" />
        WT {{ worktreeBranch }}
      </span>
      <span
        v-else-if="gitBranch"
        class="git-branch"
        :title="'Branch: ' + gitBranch"
      >
        <UIcon name="i-lucide-git-branch" class="branch-icon" />
        {{ gitBranch }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.input-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 10px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--bg-tertiary);
  font-size: 11px;
  gap: 8px;
}
.toolbar-left  { display: flex; align-items: center; gap: 6px; }
.toolbar-right { display: flex; align-items: center; gap: 6px; }

/* Native selects — dark themed */
.toolbar-select {
  background: var(--bg-primary);
  border: 1px solid var(--bg-tertiary);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 11px;
  font-family: inherit;
  color: var(--text-secondary);
  cursor: pointer;
  height: 22px;
}
.toolbar-select:focus { outline: none; border-color: var(--accent); }
.mode-select { font-weight: 600; }

/* Effort segmented group */
.effort-group {
  display: flex;
  border: 1px solid var(--bg-tertiary);
  border-radius: 4px;
  overflow: hidden;
}
.effort-btn {
  padding: 0 8px;
  height: 22px;
  font-size: 10px;
  font-family: inherit;
  color: var(--text-muted);
  background: var(--bg-primary);
  border: none;
  border-right: 1px solid var(--bg-tertiary);
  cursor: pointer;
  transition: all 0.12s;
}
.effort-btn:last-child { border-right: none; }
.effort-btn:hover:not(.effort-btn--active) { background: var(--bg-secondary); color: var(--text-secondary); }
.effort-btn--active { background: var(--bg-tertiary); color: var(--accent); font-weight: 700; }

/* Branch / worktree indicators */
.git-branch {
  color: var(--text-muted);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
  background: var(--bg-primary);
  padding: 2px 8px;
  border-radius: 3px;
  display: flex; align-items: center; gap: 4px;
}
.worktree-info {
  color: var(--accent);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
  background: var(--bg-primary);
  padding: 2px 8px;
  border-radius: 3px;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
  display: flex; align-items: center; gap: 4px;
}
.branch-icon { width: 12px; height: 12px; flex-shrink: 0; }
</style>
