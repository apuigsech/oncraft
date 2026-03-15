import { defineStore } from 'pinia';
import { ref } from 'vue';
import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { homeDir } from '@tauri-apps/api/path';
import * as yaml from 'js-yaml';
import type { GlobalSettings } from '../types';

const DEFAULT_SETTINGS: GlobalSettings = {
  claudeBinaryPath: 'claude',
  theme: 'dark',
  defaultColumns: [
    { name: 'Brainstorm', color: '#a78bfa' },
    { name: 'Specify', color: '#60a5fa' },
    { name: 'Plan', color: '#34d399' },
    { name: 'Implement', color: '#fbbf24' },
    { name: 'Review', color: '#f472b6' },
    { name: 'Done', color: '#22c55e' },
  ],
};

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<GlobalSettings>({ ...DEFAULT_SETTINGS });
  const loaded = ref(false);

  async function getSettingsPath(): Promise<string> {
    const home = await homeDir();
    return `${home}.claudban`;
  }

  async function load(): Promise<void> {
    const dir = await getSettingsPath();
    const filePath = `${dir}/settings.yaml`;
    const dirExists = await exists(dir);
    if (!dirExists) { await mkdir(dir); }
    const fileExists = await exists(filePath);
    if (fileExists) {
      const content = await readTextFile(filePath);
      const raw = yaml.load(content) as Partial<GlobalSettings>;
      settings.value = { ...DEFAULT_SETTINGS, ...raw };
    }
    loaded.value = true;
  }

  async function save(): Promise<void> {
    const dir = await getSettingsPath();
    const filePath = `${dir}/settings.yaml`;
    const content = yaml.dump(settings.value, { lineWidth: 120 });
    await writeTextFile(filePath, content);
  }

  async function updateClaudePath(path: string): Promise<void> {
    settings.value.claudeBinaryPath = path;
    await save();
  }

  return { settings, loaded, load, save, updateClaudePath };
});
