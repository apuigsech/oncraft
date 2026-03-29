import { open } from '@tauri-apps/plugin-dialog';

export function useProjectActions() {
  const projectsStore = useProjectsStore();
  const cardsStore = useCardsStore();
  const flowStore = useFlowStore();

  async function addProject(): Promise<void> {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    const path = typeof selected === 'string' ? selected : String(selected);
    const name = path.split('/').filter(Boolean).pop() || 'project';
    const project = await projectsStore.addProject(name, path);
    projectsStore.activeTab = project.id;
    await Promise.all([
      cardsStore.loadForProject(project.id),
      flowStore.loadForProject(project.path),
    ]);
  }

  async function switchToProject(projectId: string): Promise<void> {
    await projectsStore.setActive(projectId);
    projectsStore.activeTab = projectId;
    const project = projectsStore.activeProject;
    if (project) {
      await Promise.all([
        cardsStore.loadForProject(project.id),
        flowStore.loadForProject(project.path),
      ]);
    }
  }

  // Soft close — hides from TabBar, keeps in Recent Projects
  async function closeProject(projectId: string): Promise<void> {
    await projectsStore.closeProject(projectId);
    const nextOpen = projectsStore.openProjects[0];
    if (nextOpen) {
      await switchToProject(nextOpen.id);
    } else {
      projectsStore.activeTab = 'home';
    }
  }

  // Reopen a closed project and switch to it
  async function reopenProject(projectId: string): Promise<void> {
    await projectsStore.reopenProject(projectId);
    await switchToProject(projectId);
  }

  // Permanent delete — removes project and all data
  async function removeProject(projectId: string): Promise<void> {
    await projectsStore.removeProject(projectId);
    const nextOpen = projectsStore.openProjects[0];
    if (nextOpen) {
      await switchToProject(nextOpen.id);
    } else {
      projectsStore.activeTab = 'home';
    }
  }

  async function navigateToCard(projectId: string, cardId: string): Promise<void> {
    // If the project is closed, reopen it first
    const project = projectsStore.projects.find(p => p.id === projectId);
    if (project?.closed) {
      await reopenProject(projectId);
    } else {
      await switchToProject(projectId);
    }
    const sessionsStore = useSessionsStore();
    sessionsStore.openChat(cardId);
  }

  return { addProject, switchToProject, closeProject, reopenProject, removeProject, navigateToCard };
}
