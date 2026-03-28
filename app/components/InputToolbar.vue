<script setup lang="ts">
import type { ModelAlias, EffortLevel, PermissionMode } from '~/types';
import { MODEL_OPTIONS, EFFORT_LEVELS, EFFORT_LABELS, MODE_OPTIONS } from '~/constants/options';

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

const selectedEffort = computed({
  get: () => props.effort,
  set: (v: EffortLevel) => emit('update:effort', v)
});

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
    <EffortBar v-model="selectedEffort" />

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

