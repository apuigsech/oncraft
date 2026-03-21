import type { ProjectConfig, ColumnConfig } from '~/types';
import { loadProjectConfig, saveProjectConfig } from '~/services/config-loader';

export const usePipelinesStore = defineStore('pipelines', () => {
  const configs: Record<string, ProjectConfig> = reactive({});

  const DEFAULT_CONFIG: ProjectConfig = {
    columns: [
      { name: 'Brainstorm', color: '#a78bfa' },
      { name: 'Specify', color: '#60a5fa' },
      { name: 'Plan', color: '#34d399' },
      { name: 'Implement', color: '#fbbf24' },
      { name: 'Review', color: '#f472b6' },
      { name: 'Done', color: '#22c55e' },
    ],
  };

  async function loadForProject(projectPath: string): Promise<ProjectConfig> {
    try {
      const config = await loadProjectConfig(projectPath);
      configs[projectPath] = config;
      if (import.meta.dev) console.log('[OnCraft] config loaded for', projectPath, ':', config.columns.length, 'columns');
      return config;
    } catch (err) {
      if (import.meta.dev) console.warn('[OnCraft] Failed to load project config, using defaults:', err);
      configs[projectPath] = { ...DEFAULT_CONFIG };
      return configs[projectPath];
    }
  }

  function getConfig(projectPath: string): ProjectConfig | undefined {
    return configs[projectPath];
  }

  function getColumnConfig(projectPath: string, columnName: string): ColumnConfig | undefined {
    const config = configs[projectPath];
    if (!config) return undefined;
    return config.columns.find(c => c.name === columnName);
  }

  async function saveConfig(projectPath: string, config: ProjectConfig): Promise<void> {
    configs[projectPath] = config;
    try {
      await saveProjectConfig(projectPath, config);
    } catch (err) {
      console.error('[OnCraft] Failed to persist project config to disk:', err);
      throw err; // Re-throw so UI layer can show feedback
    }
  }

  return { configs, loadForProject, getConfig, getColumnConfig, saveConfig };
});
