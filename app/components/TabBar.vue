<script setup lang="ts">
import { open } from '@tauri-apps/plugin-dialog';

const projectsStore = useProjectsStore();
const cardsStore = useCardsStore();
const pipelinesStore = usePipelinesStore();

const emit = defineEmits<{ 'open-settings': []; 'open-global-settings': [] }>();

async function switchProject(projectId: string) {
  await projectsStore.setActive(projectId);
  const project = projectsStore.activeProject;
  if (project) {
    await cardsStore.loadForProject(project.id);
    await pipelinesStore.loadForProject(project.path);
  }
}

async function closeProject(projectId: string) {
  await projectsStore.removeProject(projectId);
  const active = projectsStore.activeProject;
  if (active) {
    await cardsStore.loadForProject(active.id);
    await pipelinesStore.loadForProject(active.path);
  }
}

async function addProject() {
  try {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    const path = typeof selected === 'string' ? selected : String(selected);
    const name = path.split('/').filter(Boolean).pop() || 'project';
    const project = await projectsStore.addProject(name, path);
    await cardsStore.loadForProject(project.id);
    await pipelinesStore.loadForProject(project.path);
  } catch (err) {
    if (import.meta.dev) console.error('[OnCraft] addProject error:', err);
  }
}
</script>

<template>
  <div class="tab-bar">
    <!-- Project tabs -->
    <div
      v-for="project in projectsStore.projects"
      :key="project.id"
      class="tab"
      :class="{ 'tab--active': project.id === projectsStore.activeProjectId }"
      @click="switchProject(project.id)"
    >
      <span class="tab-name">{{ project.name }}</span>
      <UButton
        variant="ghost"
        color="neutral"
        size="xs"
        icon="i-lucide-x"
        class="tab-close"
        :padded="false"
        @click.stop="closeProject(project.id)"
        title="Close project"
      />
    </div>

    <!-- Add project -->
    <UButton
      variant="ghost"
      color="neutral"
      size="sm"
      icon="i-lucide-plus"
      class="add-tab"
      :padded="false"
      title="Add project"
      @click="addProject"
    />

    <div class="spacer" />

    <!-- Project settings -->
    <UButton
      v-if="projectsStore.activeProject"
      variant="ghost"
      color="neutral"
      size="xs"
      icon="i-lucide-settings"
      title="Project settings"
      @click="emit('open-settings')"
    >
      Settings
    </UButton>

    <!-- Global settings -->
    <UButton
      variant="ghost"
      color="neutral"
      size="xs"
      icon="i-lucide-globe"
      title="Global settings"
      @click="emit('open-global-settings')"
    >
      Global
    </UButton>
  </div>
</template>

<style scoped>
.tab-bar {
  display: flex;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  padding: 0 8px;
  gap: 2px;
  height: 36px;
  align-items: flex-end;
  -webkit-app-region: drag;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px 6px 16px;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: background 0.15s;
}
.tab:hover { background: var(--bg-tertiary); }
.tab--active { background: var(--bg-primary); color: var(--text-primary); }
.tab-name { pointer-events: none; }
.tab-close { opacity: 0; transition: opacity 0.15s; -webkit-app-region: no-drag; }
.tab:hover .tab-close { opacity: 1; }

.add-tab { -webkit-app-region: no-drag; }
.spacer { flex: 1; }
</style>
