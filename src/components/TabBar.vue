<script setup lang="ts">
import { useProjectsStore } from '../stores/projects';
import { useCardsStore } from '../stores/cards';
import { usePipelinesStore } from '../stores/pipelines';
import { open } from '@tauri-apps/plugin-dialog';

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
    console.log('[ClaudBan] dialog result:', selected);
    if (!selected) return;
    const path = typeof selected === 'string' ? selected : String(selected);
    const name = path.split('/').filter(Boolean).pop() || 'project';
    console.log('[ClaudBan] adding project:', name, path);
    const project = await projectsStore.addProject(name, path);
    console.log('[ClaudBan] project added:', project.id);
    await cardsStore.loadForProject(project.id);
    await pipelinesStore.loadForProject(project.path);
    console.log('[ClaudBan] project loaded successfully');
  } catch (err) {
    console.error('[ClaudBan] addProject error:', err);
  }
}
</script>

<template>
  <div class="tab-bar">
    <div
      v-for="project in projectsStore.projects"
      :key="project.id"
      class="tab"
      :class="{ active: project.id === projectsStore.activeProjectId }"
      @click="switchProject(project.id)"
    >
      <span class="tab-name">{{ project.name }}</span>
      <button class="tab-close" @click.stop="closeProject(project.id)" title="Close project">&times;</button>
    </div>
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
.tab { display: flex; align-items: center; gap: 6px; }
.tab:hover { background: var(--bg-tertiary); }
.tab.active { background: var(--bg-primary); color: var(--text-primary); }
.tab-name { pointer-events: none; }
.tab-close {
  font-size: 14px; line-height: 1; padding: 0 2px; border-radius: 3px;
  color: var(--text-muted); opacity: 0; transition: opacity 0.15s;
}
.tab:hover .tab-close { opacity: 1; }
.tab-close:hover { background: var(--bg-tertiary); color: var(--error); }
.add-tab { color: var(--text-muted); font-size: 16px; padding: 4px 12px; }
.settings-tab { color: var(--text-muted); font-size: 12px; }
</style>
