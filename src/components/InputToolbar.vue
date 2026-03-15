<script setup lang="ts">
import type { ModelAlias, EffortLevel, PermissionMode } from '../types';

defineProps<{
  model: ModelAlias;
  effort: EffortLevel;
  permissionMode: PermissionMode;
  gitBranch?: string;
}>();

const emit = defineEmits<{
  'update:model': [value: ModelAlias];
  'update:effort': [value: EffortLevel];
  'update:permissionMode': [value: PermissionMode];
}>();

const EFFORT_OPTIONS: { value: EffortLevel; label: string }[] = [
  { value: 'low', label: 'Lo' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'Hi' },
  { value: 'max', label: 'Max' },
];

const MODE_OPTIONS: { value: PermissionMode; label: string; icon: string }[] = [
  { value: 'default', label: 'Default', icon: '🔒' },
  { value: 'acceptEdits', label: 'Auto-edit', icon: '✏️' },
  { value: 'plan', label: 'Plan', icon: '📋' },
  { value: 'bypassPermissions', label: 'YOLO', icon: '⚡' },
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
        @change="emit('update:model', ($event.target as HTMLSelectElement).value as ModelAlias)"
        class="toolbar-select"
      >
        <option value="opus">Opus</option>
        <option value="sonnet">Sonnet</option>
        <option value="haiku">Haiku</option>
      </select>

      <!-- Effort level -->
      <div class="effort-group">
        <button
          v-for="opt in EFFORT_OPTIONS" :key="opt.value"
          class="effort-btn" :class="{ active: effort === opt.value }"
          @click="emit('update:effort', opt.value)"
          :title="'Effort: ' + opt.value"
        >
          {{ opt.label }}
        </button>
      </div>

      <!-- Permission mode -->
      <select
        :value="permissionMode"
        @change="emit('update:permissionMode', ($event.target as HTMLSelectElement).value as PermissionMode)"
        class="toolbar-select mode-select"
        :style="{ color: modeColor(permissionMode) }"
      >
        <option v-for="opt in MODE_OPTIONS" :key="opt.value" :value="opt.value">
          {{ opt.icon }} {{ opt.label }}
        </option>
      </select>
    </div>

    <div class="toolbar-right">
      <!-- Git branch -->
      <span v-if="gitBranch" class="git-branch" :title="'Branch: ' + gitBranch">
        <span class="branch-icon">&#9095;</span> {{ gitBranch }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.input-toolbar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 4px 10px; background: var(--bg-secondary);
  border-bottom: 1px solid var(--bg-tertiary); font-size: 11px;
}
.toolbar-left { display: flex; align-items: center; gap: 8px; }
.toolbar-right { display: flex; align-items: center; gap: 8px; }
.toolbar-select {
  background: var(--bg-primary); border: 1px solid var(--bg-tertiary);
  border-radius: 4px; padding: 2px 6px; font-size: 11px;
  color: var(--text-secondary); cursor: pointer;
}
.toolbar-select:focus { outline: none; border-color: var(--accent); }
.effort-group {
  display: flex; border: 1px solid var(--bg-tertiary);
  border-radius: 4px; overflow: hidden;
}
.effort-btn {
  padding: 2px 8px; font-size: 10px; color: var(--text-muted);
  background: var(--bg-primary); border: none; border-right: 1px solid var(--bg-tertiary);
  transition: all 0.15s;
}
.effort-btn:last-child { border-right: none; }
.effort-btn.active { font-weight: 700; background: var(--bg-tertiary); color: var(--accent); }
.effort-btn:hover:not(.active) { background: var(--bg-secondary); }
.mode-select { font-weight: 600; }
.git-branch {
  color: var(--text-muted); font-family: 'SF Mono', 'Fira Code', monospace; font-size: 11px;
  background: var(--bg-primary); padding: 2px 8px; border-radius: 3px;
}
.branch-icon { font-size: 12px; }
</style>
