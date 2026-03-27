<script setup lang="ts">
import type { ModelAlias, EffortLevel, PermissionMode } from '~/types';

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

const MODEL_OPTIONS = [
  { label: 'Opus',   value: 'opus' as ModelAlias,   icon: 'i-simple-icons-anthropic' },
  { label: 'Sonnet', value: 'sonnet' as ModelAlias, icon: 'i-simple-icons-anthropic' },
  { label: 'Haiku',  value: 'haiku' as ModelAlias,  icon: 'i-simple-icons-anthropic' },
];

const EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'max'];
const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: 'Lo',
  medium: 'Med',
  high: 'Hi',
  max: 'Max',
};

const MODE_OPTIONS = [
  { label: 'Default',   value: 'default' as PermissionMode,           icon: 'i-lucide-lock' },
  { label: 'Auto-edit', value: 'acceptEdits' as PermissionMode,       icon: 'i-lucide-pencil',         class: 'text-primary',  ui: { itemLeadingIcon: 'text-primary' } },
  { label: 'Plan',      value: 'plan' as PermissionMode,              icon: 'i-lucide-clipboard-list', class: 'text-warning',  ui: { itemLeadingIcon: 'text-warning' } },
  { label: 'YOLO',      value: 'bypassPermissions' as PermissionMode, icon: 'i-lucide-zap',            class: 'text-error',    ui: { itemLeadingIcon: 'text-error' } },
];

const selectedModel = computed({
  get: () => props.model,
  set: (v: ModelAlias) => emit('update:model', v)
});

const selectedMode = computed({
  get: () => props.permissionMode,
  set: (v: PermissionMode) => emit('update:permissionMode', v)
});

const currentModelIcon = computed(() => MODEL_OPTIONS.find(m => m.value === props.model)?.icon);
const currentModeIcon = computed(() => MODE_OPTIONS.find(m => m.value === props.permissionMode)?.icon);

const effortIndex = computed({
  get: () => EFFORT_LEVELS.indexOf(props.effort),
  set: (v: number) => emit('update:effort', EFFORT_LEVELS[v]!)
});

const effortLabel = computed(() => EFFORT_LABELS[props.effort]);

// Orange gradient: lighter at low, stronger at max
const effortColors: Record<EffortLevel, string> = {
  low:    '#fdba74',  // orange-300
  medium: '#fb923c',  // orange-400
  high:   '#f97316',  // orange-500
  max:    '#ea580c',  // orange-600
};

const effortColor = computed(() => effortColors[props.effort]);

const modeColorClass = computed(() => {
  switch (props.permissionMode) {
    case 'acceptEdits': return 'text-primary';
    case 'plan': return 'text-warning';
    case 'bypassPermissions': return 'text-error';
    default: return '';
  }
});
</script>

<template>
  <div class="flex items-center gap-1 flex-1 min-w-0">
    <!-- Permission mode -->
    <USelectMenu
      v-model="selectedMode"
      :items="MODE_OPTIONS"
      :icon="currentModeIcon"
      size="sm"
      variant="ghost"
      value-key="value"
      :search-input="false"
      :class="['data-[state=open]:bg-elevated', modeColorClass]"
      :ui="{
        trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200',
        leadingIcon: modeColorClass,
        value: modeColorClass
      }"
    />

    <!-- Model selector -->
    <USelectMenu
      v-model="selectedModel"
      :items="MODEL_OPTIONS"
      :icon="currentModelIcon"
      size="sm"
      variant="ghost"
      value-key="value"
      :search-input="false"
      class="data-[state=open]:bg-elevated"
      :ui="{
        trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200'
      }"
    />

    <!-- Effort level -->
    <div class="effort-bars" :title="'Effort: ' + effort">
      <div
        v-for="(level, i) in EFFORT_LEVELS"
        :key="level"
        class="effort-bar"
        :class="{ active: i <= effortIndex }"
        @click="emit('update:effort', level)"
      />
      <span class="effort-label">{{ effortLabel }}</span>
    </div>

    <!-- Branch info (right side) -->
    <div class="ml-auto flex-shrink-0">
      <UBadge
        v-if="worktreeBranch"
        variant="subtle"
        color="primary"
        size="sm"
        icon="i-lucide-git-branch"
        :label="'WT ' + worktreeBranch"
        :title="'Worktree: ' + (worktreePath || '')"
      />
      <UBadge
        v-else-if="gitBranch"
        variant="soft"
        color="neutral"
        size="sm"
        icon="i-lucide-git-branch"
        :label="gitBranch"
        :title="'Branch: ' + gitBranch"
      />
    </div>
  </div>
</template>

<style scoped>
.effort-bars {
  display: flex;
  align-items: center;
  gap: 3px;
  cursor: pointer;
}
.effort-bar {
  width: 6px;
  height: 14px;
  border-radius: 2px;
  background: var(--text-muted);
  cursor: pointer;
  transition: background 0.15s;
  opacity: 0.35;
}
.effort-bar.active {
  background: #f97316;
  opacity: 1;
}
.effort-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--ui-text-muted);
  margin-left: 4px;
}
</style>
