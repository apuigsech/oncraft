// Per-project file viewer state — each project tab has its own open file
const fileByProject = reactive(new Map<string, { label: string; path: string; cardId: string }>());

export function useFileViewer() {
  const projectsStore = useProjectsStore();

  const activeFile = computed(() => {
    const pid = projectsStore.activeProjectId;
    if (!pid) return null;
    return fileByProject.get(pid) ?? null;
  });

  function openFile(cardId: string, label: string, path: string) {
    const pid = projectsStore.activeProjectId;
    if (!pid) return;
    fileByProject.set(pid, { cardId, label, path });
  }

  function closeFile() {
    const pid = projectsStore.activeProjectId;
    if (!pid) return;
    fileByProject.delete(pid);
  }

  return {
    activeFile,
    openFile,
    closeFile,
  };
}
