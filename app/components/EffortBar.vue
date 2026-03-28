<script setup lang="ts">
import type { EffortLevel } from '~/types';
import { EFFORT_LEVELS, EFFORT_LABELS } from '~/constants/options';

const model = defineModel<EffortLevel>({ required: true });

const effortIndex = computed(() => EFFORT_LEVELS.indexOf(model.value));
const effortLabel = computed(() => EFFORT_LABELS[model.value]);
</script>

<template>
  <div class="effort-bars" :title="'Effort: ' + model">
    <div
      v-for="(level, i) in EFFORT_LEVELS"
      :key="level"
      class="effort-bar"
      :class="{ active: i <= effortIndex }"
      @click="model = level"
    />
    <span class="effort-label">{{ effortLabel }}</span>
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
