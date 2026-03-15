import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { v4 as uuidv4 } from 'uuid';
import type { Project } from '../types';
import * as db from '../services/database';

export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<Project[]>([]);
  const activeProjectId = ref<string | null>(null);

  const activeProject = computed(() =>
    projects.value.find(p => p.id === activeProjectId.value) || null
  );

  async function load(): Promise<void> {
    projects.value = await db.getAllProjects();
    if (projects.value.length > 0 && !activeProjectId.value) {
      activeProjectId.value = projects.value[0].id;
    }
  }

  async function addProject(name: string, path: string): Promise<Project> {
    const project: Project = {
      id: uuidv4(),
      name, path,
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    };
    await db.insertProject(project);
    projects.value.push(project);
    activeProjectId.value = project.id;
    return project;
  }

  async function removeProject(id: string): Promise<void> {
    await db.deleteProject(id);
    projects.value = projects.value.filter(p => p.id !== id);
    if (activeProjectId.value === id) {
      activeProjectId.value = projects.value[0]?.id || null;
    }
  }

  async function setActive(id: string): Promise<void> {
    activeProjectId.value = id;
    await db.updateProjectLastOpened(id);
  }

  return { projects, activeProjectId, activeProject, load, addProject, removeProject, setActive };
});
