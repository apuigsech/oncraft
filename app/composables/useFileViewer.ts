// Global state for the file viewer — which file is currently open across all cards
const activeFile = ref<{ label: string; path: string; cardId: string } | null>(null);

export function useFileViewer() {
  function openFile(cardId: string, label: string, path: string) {
    activeFile.value = { cardId, label, path };
  }

  function closeFile() {
    activeFile.value = null;
  }

  return {
    activeFile: readonly(activeFile),
    openFile,
    closeFile,
  };
}
