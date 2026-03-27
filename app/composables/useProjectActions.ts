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

  async function closeProject(projectId: string): Promise<void> {
    await projectsStore.removeProject(projectId);
    const active = projectsStore.activeProject;
    if (active) {
      projectsStore.activeTab = active.id;
      await Promise.all([
        cardsStore.loadForProject(active.id),
        flowStore.loadForProject(active.path),
      ]);
    } else {
      projectsStore.activeTab = 'home';
    }
  }

  async function navigateToCard(projectId: string, cardId: string): Promise<void> {
    await switchToProject(projectId);
    const sessionsStore = useSessionsStore();
    sessionsStore.openChat(cardId);
  }

  return { addProject, switchToProject, closeProject, navigateToCard };
}
