import { defineStore } from 'pinia';
import { reactive } from 'vue';
import type { ProjectConfig } from '../types';
import { loadProjectConfig, saveProjectConfig } from '../services/config-loader';

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
    pipelines: [],
  };

  async function loadForProject(projectPath: string): Promise<ProjectConfig> {
    try {
      const config = await loadProjectConfig(projectPath);
      configs[projectPath] = config;
      console.log('[ClaudBan] config loaded for', projectPath, ':', config.columns.length, 'columns');
      return config;
    } catch (err) {
      console.warn('[ClaudBan] Failed to load project config, using defaults:', err);
      configs[projectPath] = { ...DEFAULT_CONFIG };
      return configs[projectPath];
    }
  }

  function getConfig(projectPath: string): ProjectConfig | undefined {
    return configs[projectPath];
  }

  function findPipeline(projectPath: string, from: string, to: string) {
    const config = configs[projectPath];
    if (!config) return undefined;
    return config.pipelines.find(p => p.from === from && p.to === to);
  }

  async function saveConfig(projectPath: string, config: ProjectConfig): Promise<void> {
    configs[projectPath] = config;
    await saveProjectConfig(projectPath, config);
  }

  return { configs, loadForProject, getConfig, findPipeline, saveConfig };
});
