import { readTextFile, writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import * as yaml from 'js-yaml';
import type { ProjectConfig, ColumnConfig, PipelineConfig } from '../types';

const CONFIG_DIR = '.claudban';
const CONFIG_FILE = '.claudban/config.yaml';

const DEFAULT_COLUMNS: ColumnConfig[] = [
  { name: 'Brainstorm', color: '#a78bfa' },
  { name: 'Specify', color: '#60a5fa' },
  { name: 'Plan', color: '#34d399' },
  { name: 'Implement', color: '#fbbf24' },
  { name: 'Review', color: '#f472b6' },
  { name: 'Done', color: '#22c55e' },
];

const DEFAULT_PIPELINES: PipelineConfig[] = [
  {
    from: 'Brainstorm', to: 'Specify',
    prompt: 'Based on our brainstorming in session {{session.name}}, create a formal specification.\nProject: {{project.path}}',
  },
  {
    from: 'Specify', to: 'Plan',
    prompt: 'Review the specification and create an implementation plan for {{session.name}}.',
  },
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
    console.warn('[ClaudBan] config load error, using defaults:', err);
    // Try to create it, but don't fail if we can't
    try { await createDefaultConfig(projectPath); } catch { /* ignore */ }
    return { columns: DEFAULT_COLUMNS, pipelines: DEFAULT_PIPELINES };
  }
}

async function createDefaultConfig(projectPath: string): Promise<ProjectConfig> {
  const config: ProjectConfig = {
    columns: DEFAULT_COLUMNS,
    pipelines: DEFAULT_PIPELINES,
  };
  try {
    const dirPath = `${projectPath}/${CONFIG_DIR}`;
    const dirExists = await exists(dirPath);
    if (!dirExists) {
      await mkdir(dirPath);
    }
    await saveProjectConfig(projectPath, config);
  } catch (err) {
    console.warn('[ClaudBan] could not save default config:', err);
  }
  return config;
}

export async function saveProjectConfig(
  projectPath: string, config: ProjectConfig
): Promise<void> {
  const configPath = `${projectPath}/${CONFIG_FILE}`;
  const content = yaml.dump(config, { lineWidth: 120 });
  await writeTextFile(configPath, content);
}

function validateConfig(raw: Record<string, unknown>): ProjectConfig {
  const columns = (raw.columns as ColumnConfig[]) || DEFAULT_COLUMNS;
  const pipelines = (raw.pipelines as PipelineConfig[]) || [];
  const uniqueColumns: ColumnConfig[] = [];
  const seenNames = new Set<string>();
  for (const col of columns) {
    if (col.name && !seenNames.has(col.name)) {
      seenNames.add(col.name);
      uniqueColumns.push(col);
    }
  }
  const validPipelines: PipelineConfig[] = [];
  const seenTransitions = new Set<string>();
  for (const p of pipelines) {
    const key = `${p.from}->${p.to}`;
    if (seenNames.has(p.from) && seenNames.has(p.to) && !seenTransitions.has(key)) {
      seenTransitions.add(key);
      validPipelines.push(p);
    }
  }
  return { columns: uniqueColumns, pipelines: validPipelines };
}
