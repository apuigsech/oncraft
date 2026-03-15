<script setup lang="ts">
import { useProjectsStore } from '../stores/projects';
import { useCardsStore } from '../stores/cards';
import { usePipelinesStore } from '../stores/pipelines';
import { open } from '@tauri-apps/plugin-dialog';
import { basename } from '@tauri-apps/api/path';

const projectsStore = useProjectsStore();
const cardsStore = useCardsStore();
const pipelinesStore = usePipelinesStore();

async function switchProject(projectId: string) {
  await projectsStore.setActive(projectId);
  const project = projectsStore.activeProject;
  if (project) {
    await cardsStore.loadForProject(project.id);
    await pipelinesStore.loadForProject(project.path);
  }
}

async function addProject() {
  const selected = await open({ directory: true, multiple: false });
  if (!selected) return;
  const path = selected as string;
  const name = await basename(path);
  const project = await projectsStore.addProject(name, path);
  await cardsStore.loadForProject(project.id);
  await pipelinesStore.loadForProject(project.path);
}
</script>

<template>
  <div class="tab-bar">
    <button
      v-for="project in projectsStore.projects"
      :key="project.id"
      class="tab"
      :class="{ active: project.id === projectsStore.activeProjectId }"
      @click="switchProject(project.id)"
    >
      {{ project.name }}
    </button>
    <button class="tab add-tab" @click="addProject">+</button>
    <div style="flex:1" />
    <button
      v-if="projectsStore.activeProject"
      class="tab settings-tab"
      @click="$emit('open-settings')"
      title="Project settings"
    >
      Settings
    </button>
    <button class="tab settings-tab" @click="$emit('open-global-settings')" title="Global settings">Global</button>
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
  padding: 6px 16px;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  -webkit-app-region: no-drag;
  transition: background 0.15s;
}
.tab:hover { background: var(--bg-tertiary); }
.tab.active { background: var(--bg-primary); color: var(--text-primary); }
.add-tab { color: var(--text-muted); font-size: 16px; padding: 4px 12px; }
.settings-tab { color: var(--text-muted); font-size: 12px; }
</style>
