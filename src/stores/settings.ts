import { defineStore } from 'pinia';
import { ref } from 'vue';
import { readTextFile, writeTextFile, exists, mkdir, BaseDirectory } from '@tauri-apps/plugin-fs';
import * as yaml from 'js-yaml';
import type { GlobalSettings } from '../types';

const DEFAULT_SETTINGS: GlobalSettings = {
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

  const SETTINGS_FILE = 'settings.yaml';

  async function load(): Promise<void> {
    try {
      const dirExists = await exists('', { baseDir: BaseDirectory.AppConfig });
      if (!dirExists) {
        await mkdir('', { baseDir: BaseDirectory.AppConfig, recursive: true });
      }
    } catch {
      // Directory might already exist
    }
    try {
      const fileExists = await exists(SETTINGS_FILE, { baseDir: BaseDirectory.AppConfig });
      if (fileExists) {
        const content = await readTextFile(SETTINGS_FILE, { baseDir: BaseDirectory.AppConfig });
        const raw = yaml.load(content) as Partial<GlobalSettings>;
        settings.value = { ...DEFAULT_SETTINGS, ...raw };
      }
    } catch (err) {
      console.warn('[ClaudBan] Could not load settings, using defaults:', err);
    }
    loaded.value = true;
  }

  async function save(): Promise<void> {
    try {
      await mkdir('', { baseDir: BaseDirectory.AppConfig, recursive: true });
    } catch {
      // Already exists
    }
    const content = yaml.dump(settings.value, { lineWidth: 120 });
    await writeTextFile(SETTINGS_FILE, content, { baseDir: BaseDirectory.AppConfig });
  }

  return { settings, loaded, load, save };
});
