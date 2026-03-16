<script setup lang="ts">

const projectsStore = useProjectsStore();
const pipelinesStore = usePipelinesStore();

const columns = computed(() => {
  const project = projectsStore.activeProject;
  if (!project) return [];
  const config = pipelinesStore.getConfig(project.path);
  return config?.columns || [];
});
</script>

<template>
  <div class="kanban-board">
    <KanbanColumn v-for="col in columns" :key="col.name" :column="col" />
  </div>
</template>

<style scoped>
.kanban-board { display: flex; gap: 12px; padding: 16px; height: 100%; overflow-x: auto; align-items: stretch; }
</style>
