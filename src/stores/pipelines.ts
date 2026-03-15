import { defineStore } from 'pinia';
import { reactive } from 'vue';
import type { ProjectConfig } from '../types';
import { loadProjectConfig, saveProjectConfig } from '../services/config-loader';

export const usePipelinesStore = defineStore('pipelines', () => {
  const configs: Record<string, ProjectConfig> = reactive({});

  async function loadForProject(projectPath: string): Promise<ProjectConfig> {
    const config = await loadProjectConfig(projectPath);
    configs[projectPath] = config;
    return config;
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
