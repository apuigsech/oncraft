// Compatibility shim — delegates to useFlowStore.
// Kept to avoid breaking components that still reference usePipelinesStore during transition.
// NOTE: getConfig().github is intentionally omitted — GitHub config is no longer part of Flow.
// Components reading github config must be updated to read from useProjectsStore() directly.
import type { ProjectConfig, ColumnConfig } from '~/types';

export const usePipelinesStore = defineStore('pipelines', () => {
  const flowStore = useFlowStore();

  function getConfig(_projectPath: string): ProjectConfig | undefined {
    if (!flowStore.flow) return undefined;
    return {
      columns: flowStore.flow.states.map(s => ({
        name:    s.name,
        color:   s.color,
        icon:    s.icon,
        inputs:  [],
        outputs: [],
      })),
      // github intentionally omitted — see comment above
    };
  }

  function getColumnConfig(_projectPath: string, columnName: string): ColumnConfig | undefined {
    if (!flowStore.flow) return undefined;
    // Match by display name or slug
    const state = flowStore.flow.states.find(
      s => s.name === columnName || s.slug === columnName
    );
    if (!state) return undefined;
    return { name: state.name, color: state.color, icon: state.icon };
  }

  // loadForProject delegates to flowStore
  async function loadForProject(projectPath: string): Promise<ProjectConfig> {
    await flowStore.loadForProject(projectPath);
    return getConfig(projectPath) ?? { columns: [] };
  }

  // saveConfig is a no-op in the new model — edit .oncraft/flow.yaml directly
  async function saveConfig(_projectPath: string, _config: ProjectConfig): Promise<void> {
    if (import.meta.dev) console.warn('[OnCraft] usePipelinesStore.saveConfig() is deprecated; edit .oncraft/flow.yaml directly');
  }

  return { getConfig, getColumnConfig, loadForProject, saveConfig };
});
