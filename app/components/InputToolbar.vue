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

const EFFORT_OPTIONS = [
  { label: 'Lo',  value: 'low' as EffortLevel },
  { label: 'Med', value: 'medium' as EffortLevel },
  { label: 'Hi',  value: 'high' as EffortLevel },
  { label: 'Max', value: 'max' as EffortLevel },
];

const MODE_OPTIONS = [
  { label: 'Default',   value: 'default' as PermissionMode,           icon: 'i-lucide-lock',           chip: { color: 'neutral' as const } },
  { label: 'Auto-edit', value: 'acceptEdits' as PermissionMode,       icon: 'i-lucide-pencil',         chip: { color: 'primary' as const } },
  { label: 'Plan',      value: 'plan' as PermissionMode,              icon: 'i-lucide-clipboard-list', chip: { color: 'warning' as const } },
  { label: 'YOLO',      value: 'bypassPermissions' as PermissionMode, icon: 'i-lucide-zap',            chip: { color: 'error' as const } },
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
</script>

<template>
  <div class="flex items-center gap-1 flex-1 min-w-0">
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
    <UButtonGroup size="xs">
      <UButton
        v-for="opt in EFFORT_OPTIONS"
        :key="opt.value"
        :label="opt.label"
        :variant="effort === opt.value ? 'solid' : 'ghost'"
        :color="effort === opt.value ? 'primary' : 'neutral'"
        @click="emit('update:effort', opt.value)"
      />
    </UButtonGroup>

    <!-- Permission mode -->
    <USelectMenu
      v-model="selectedMode"
      :items="MODE_OPTIONS"
      :icon="currentModeIcon"
      size="sm"
      variant="ghost"
      value-key="value"
      :search-input="false"
      class="data-[state=open]:bg-elevated"
      :ui="{
        trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200'
      }"
    />

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
