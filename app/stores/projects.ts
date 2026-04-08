import { v4 as uuidv4 } from 'uuid';
import type { Project } from '~/types';
import * as db from '~/services/database';

export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<Project[]>([]);
  const activeProjectId = ref<string | null>(null);

  // NAV: Tracks the active tab — 'home', 'settings', or a project ID.
  // Owned here so that sessions store can derive per-project active chat correctly.
  const activeTab = ref<string>('home');
  const isProjectTab = computed(() => activeTab.value !== 'home' && activeTab.value !== 'settings');

  const activeProject = computed(() =>
    projects.value.find(p => p.id === activeProjectId.value) || null
  );

  // Only open (non-closed) projects — used by TabBar
  const openProjects = computed(() =>
    projects.value.filter(p => !p.closed)
  );

  async function load(): Promise<void> {
    projects.value = await db.getAllProjects();
    if (projects.value.length > 0 && !activeProjectId.value) {
      const firstOpen = projects.value.find(p => !p.closed);
      activeProjectId.value = firstOpen?.id || null;
    }
  }

  async function addProject(name: string, path: string): Promise<Project> {
    // Check in-memory first — may be a closed project being reopened
    const existing = projects.value.find(p => p.path === path);
    if (existing) {
      if (existing.closed) {
        await reopenProject(existing.id);
      }
      activeProjectId.value = existing.id;
      await db.updateProjectLastOpened(existing.id);
      return existing;
    }

    const project: Project = {
      id: uuidv4(),
      name, path,
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    };
    try {
      await db.insertProject(project);
    } catch {
      // UNIQUE constraint — project exists in DB but not in memory (load() may have failed)
      await load(); // Reload from DB
      const reloaded = projects.value.find(p => p.path === path);
      if (reloaded) {
        if (reloaded.closed) {
          await reopenProject(reloaded.id);
        }
        activeProjectId.value = reloaded.id;
        await db.updateProjectLastOpened(reloaded.id);
        return reloaded;
      }
      throw new Error(`Failed to add project at ${path}`);
    }
    projects.value = [...projects.value, project];
    activeProjectId.value = project.id;
    return project;
  }

  // Permanent delete — removes project and all its cards from DB
  async function removeProject(id: string): Promise<void> {
    await db.deleteProject(id);
    projects.value = projects.value.filter(p => p.id !== id);
    if (activeProjectId.value === id) {
      const nextOpen = projects.value.find(p => !p.closed);
      activeProjectId.value = nextOpen?.id || null;
    }
  }

  // Soft close — hides from TabBar but keeps in Recent Projects
  async function closeProject(id: string): Promise<void> {
    const cardsStore = useCardsStore();
    const sessionsStore = useSessionsStore();
    const projectCards = cardsStore.cards.filter(c => c.projectId === id);
    for (const c of projectCards) {
      try { await sessionsStore.stopSession(c.id); } catch { /* best effort */ }
      sessionsStore.purgeCard(c.id);
    }
    await db.setProjectClosed(id, true);
    const project = projects.value.find(p => p.id === id);
    if (project) project.closed = true;
    if (activeProjectId.value === id) {
      const nextOpen = projects.value.find(p => !p.closed);
      activeProjectId.value = nextOpen?.id || null;
    }
  }

  // Reopen a closed project
  async function reopenProject(id: string): Promise<void> {
    await db.setProjectClosed(id, false);
    await db.updateProjectLastOpened(id);
    const project = projects.value.find(p => p.id === id);
    if (project) {
      project.closed = false;
      project.lastOpenedAt = new Date().toISOString();
    }
  }

  async function setActive(id: string): Promise<void> {
    activeProjectId.value = id;
    await db.updateProjectLastOpened(id);
  }

  async function reorderProjects(orderedIds: string[]): Promise<void> {
    const reordered = orderedIds
      .map(id => projects.value.find(p => p.id === id))
      .filter((p): p is Project => p !== undefined);
    projects.value = reordered;
    await db.updateProjectTabOrder(orderedIds);
  }

  return {
    projects, openProjects, activeProjectId, activeTab, isProjectTab, activeProject,
    load, addProject, removeProject, closeProject, reopenProject, setActive, reorderProjects,
  };
});
