<script setup lang="ts">
const projectsStore = useProjectsStore();
const flowStore = useFlowStore();

const project = computed(() => projectsStore.activeProject);

const shortenedPath = computed(() => {
  if (!project.value) return '';
  const home = typeof process !== 'undefined' ? process.env.HOME : undefined;
  const path = project.value.path;
  if (home && path.startsWith(home)) {
    return '~' + path.slice(home.length);
  }
  return path;
});

const githubRepo = computed(() => flowStore.githubRepository);
const presetName = computed(() => flowStore.flow?.preset);
</script>

<template>
  <div v-if="project" class="info-bar">
    <div class="info-item">
      <UIcon name="i-lucide-folder" class="info-icon" />
      <span class="info-text">{{ shortenedPath }}</span>
    </div>
    <template v-if="githubRepo">
      <div class="info-divider" />
      <div class="info-item">
        <UIcon name="i-lucide-git-branch" class="info-icon" />
        <span class="info-text">{{ githubRepo }}</span>
      </div>
    </template>
    <template v-if="presetName">
      <div class="info-divider" />
      <div class="info-item">
        <UIcon name="i-lucide-refresh-cw" class="info-icon" />
        <span class="info-text info-text--accent">{{ presetName }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.info-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
  height: 28px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 5px;
}

.info-icon {
  width: 12px;
  height: 12px;
  color: var(--text-muted);
  opacity: 0.6;
  flex-shrink: 0;
}

.info-text {
  font-size: 11px;
  color: var(--text-secondary);
}

.info-text--accent {
  color: var(--accent);
}

.info-divider {
  width: 1px;
  height: 12px;
  background: var(--border);
  flex-shrink: 0;
}
</style>
