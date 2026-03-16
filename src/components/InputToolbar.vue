<script setup lang="ts">
import { computed } from 'vue';
import type { DropdownMenuItem } from '@nuxt/ui';
import type { ModelAlias, EffortLevel, PermissionMode } from '../types';

const props = defineProps<{
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

const MODEL_OPTIONS: { value: ModelAlias; label: string }[] = [
  { value: 'opus',   label: 'Opus'   },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku',  label: 'Haiku'  },
];

const MODE_OPTIONS: { value: PermissionMode; label: string; icon: string }[] = [
  { value: 'default',           label: 'Default',   icon: 'i-lucide-lock'           },
  { value: 'acceptEdits',       label: 'Auto-edit', icon: 'i-lucide-pencil'         },
  { value: 'plan',              label: 'Plan',      icon: 'i-lucide-clipboard-list' },
  { value: 'bypassPermissions', label: 'YOLO',      icon: 'i-lucide-zap'            },
];

const modelItems = computed((): DropdownMenuItem[][] => [
  MODEL_OPTIONS.map(o => ({
    label: o.label,
    active: props.model === o.value,
    onSelect: () => emit('update:model', o.value),
  })),
]);

const modeItems = computed((): DropdownMenuItem[][] => [
  MODE_OPTIONS.map(o => ({
    label: o.label,
    icon: o.icon,
    active: props.permissionMode === o.value,
    onSelect: () => emit('update:permissionMode', o.value),
  })),
]);

const currentModel = computed(() => MODEL_OPTIONS.find(o => o.value === props.model)?.label ?? props.model);
const currentMode  = computed(() => MODE_OPTIONS.find(o => o.value === props.permissionMode)!);

const modeColor = computed((): 'neutral' | 'success' | 'warning' | 'error' => {
  switch (props.permissionMode) {
    case 'acceptEdits':       return 'success';
    case 'plan':              return 'warning';
    case 'bypassPermissions': return 'error';
    default:                  return 'neutral';
  }
});
</script>

<template>
  <div class="input-toolbar">
    <div class="toolbar-left">

      <!-- Model selector -->
      <UDropdownMenu :items="modelItems" :content="{ side: 'top', sideOffset: 6 }" size="xs">
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          trailing-icon="i-lucide-chevron-down"
        >{{ currentModel }}</UButton>
      </UDropdownMenu>

      <!-- Effort segmented group -->
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

      <!-- Permission mode selector -->
      <UDropdownMenu :items="modeItems" :content="{ side: 'top', sideOffset: 6 }" size="xs">
        <UButton
          size="xs"
          variant="ghost"
          :color="modeColor"
          :leading-icon="currentMode.icon"
          trailing-icon="i-lucide-chevron-down"
        >{{ currentMode.label }}</UButton>
      </UDropdownMenu>

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
  padding: 2px 8px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--bg-tertiary);
  gap: 6px;
}
.toolbar-left  { display: flex; align-items: center; gap: 4px; }
.toolbar-right { display: flex; align-items: center; gap: 6px; }

/* Effort segmented group */
.effort-group {
  display: flex;
  border: 1px solid var(--bg-tertiary);
  border-radius: 4px;
  overflow: hidden;
}
.effort-btn {
  padding: 0 8px;
  height: 24px;
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
