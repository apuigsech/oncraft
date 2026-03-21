import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import * as yaml from 'js-yaml';
import type { ProjectConfig, ColumnConfig, GitHubConfig } from '~/types';

const CONFIG_DIR = '.oncraft';
const CONFIG_FILE = '.oncraft/config.yaml';

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { name: 'Brainstorm', color: '#a78bfa' },
  { name: 'Specify', color: '#60a5fa' },
  { name: 'Plan', color: '#34d399' },
  { name: 'Implement', color: '#fbbf24' },
  { name: 'Review', color: '#f472b6' },
  { name: 'Done', color: '#22c55e' },
];

export async function loadProjectConfig(projectPath: string): Promise<ProjectConfig> {
  const configPath = `${projectPath}/${CONFIG_FILE}`;
  try {
    const configExists = await exists(configPath);
    if (!configExists) {
      return await createDefaultConfig(projectPath);
    }
    const content = await readTextFile(configPath);
    const raw = yaml.load(content) as Record<string, unknown>;
    return validateConfig(raw);
  } catch (err) {
    if (import.meta.dev) console.warn('[OnCraft] config load error, using defaults:', err);
    // Try to create it, but don't fail if we can't
    try { await createDefaultConfig(projectPath); } catch { /* ignore */ }
    return { columns: DEFAULT_COLUMNS };
  }
}

async function createDefaultConfig(projectPath: string): Promise<ProjectConfig> {
  const config: ProjectConfig = {
    columns: DEFAULT_COLUMNS,
  };
  try {
    const dirPath = `${projectPath}/${CONFIG_DIR}`;
    const dirExists = await exists(dirPath);
    if (!dirExists) {
      await mkdir(dirPath);
    }
    await saveProjectConfig(projectPath, config);
  } catch (err) {
    if (import.meta.dev) console.warn('[OnCraft] could not save default config:', err);
  }
  return config;
}

export async function saveProjectConfig(
  projectPath: string, config: ProjectConfig
): Promise<void> {
  // Ensure .oncraft/ directory exists before writing
  const dirPath = `${projectPath}/${CONFIG_DIR}`;
  try {
    const dirExists = await exists(dirPath);
    if (!dirExists) {
      await mkdir(dirPath, { recursive: true });
    }
  } catch (err) {
    // mkdir may race or fail on certain FS — log but try writing anyway
    if (import.meta.dev) console.warn('[OnCraft] mkdir warning:', err);
  }
  const configPath = `${projectPath}/${CONFIG_FILE}`;
  const content = yaml.dump(config, { lineWidth: 120 });
  await writeTextFile(configPath, content);
}

function validateConfig(raw: Record<string, unknown>): ProjectConfig {
  const columns = (raw.columns as ColumnConfig[]) || DEFAULT_COLUMNS;
  const uniqueColumns: ColumnConfig[] = [];
  const seenNames = new Set<string>();
  for (const col of columns) {
    if (col.name && !seenNames.has(col.name)) {
      seenNames.add(col.name);
      // Ensure inputs/outputs are arrays
      uniqueColumns.push({
        ...col,
        inputs: Array.isArray(col.inputs) ? col.inputs : [],
        outputs: Array.isArray(col.outputs) ? col.outputs : [],
      });
    }
  }

  // Preserve optional settings sections
  const github = raw.github as GitHubConfig | undefined;

  const config: ProjectConfig = { columns: uniqueColumns };
  if (github) config.github = github;
  return config;
}
