import { readTextFile, writeTextFile, exists, mkdir, BaseDirectory } from '@tauri-apps/plugin-fs';
import * as yaml from 'js-yaml';
import type { GlobalSettings } from '~/types';

const DEFAULT_SETTINGS: GlobalSettings = {
  theme: 'dark',
  chatMode: 'integrated',
  defaultModel: 'sonnet',
  defaultEffort: 'high',
  defaultPermissionMode: 'default',
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
    } catch (e) {
      if (import.meta.dev) console.warn('[OnCraft] mkdir AppConfig:', e);
    }
    try {
      const fileExists = await exists(SETTINGS_FILE, { baseDir: BaseDirectory.AppConfig });
      if (fileExists) {
        const content = await readTextFile(SETTINGS_FILE, { baseDir: BaseDirectory.AppConfig });
        const raw = yaml.load(content) as Partial<GlobalSettings>;
        settings.value = { ...DEFAULT_SETTINGS, ...raw };
      }
    } catch (err) {
      if (import.meta.dev) console.warn('[OnCraft] Could not load settings, using defaults:', err);
    }
    loaded.value = true;
  }

  async function save(): Promise<void> {
    try {
      await mkdir('', { baseDir: BaseDirectory.AppConfig, recursive: true });
    } catch (e) {
      if (import.meta.dev) console.warn('[OnCraft] mkdir AppConfig on save:', e);
    }
    const content = yaml.dump(settings.value, { lineWidth: 120 });
    await writeTextFile(SETTINGS_FILE, content, { baseDir: BaseDirectory.AppConfig });
  }

  return { settings, loaded, load, save };
});
