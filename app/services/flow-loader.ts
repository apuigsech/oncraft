import { readTextFile, writeTextFile, exists, mkdir, copyFile, readDir } from '@tauri-apps/plugin-fs';
import { homeDir, resourceDir, join as pathJoin } from '@tauri-apps/api/path';
import * as yaml from 'js-yaml';
import type { Flow, FlowState, AgentConfig, McpServerConfig, FlowWarning } from '~/types';

// ─── Path constants (all resolved relative to projectPath — repo root) ────────

const ONCRAFT_DIR   = '.oncraft';
const STATES_DIR    = `${ONCRAFT_DIR}/states`;   // .oncraft/states
const FLOW_FILE     = `${ONCRAFT_DIR}/flow.yaml`;

// Bundled presets installed to ~/.oncraft/presets/ on first launch
const BUNDLED_PRESETS = ['swe-basic'];

// ─── Default Flow (in-memory fallback only) ───────────────────────────────────

function makeDefaultFlow(): Flow {
  return {
    name: 'Default',
    agent: { model: 'sonnet', effort: 'high', permissionMode: 'default' },
    agents: [],
    skills: [],
    mcpServers: {},
    tools: { allowed: [], disallowed: [] },
    stateOrder: ['brainstorm', 'specify', 'plan', 'implement', 'review', 'done'],
    states: [
      { slug: 'brainstorm', name: 'Brainstorm', color: '#a78bfa' },
      { slug: 'specify',    name: 'Specify',    color: '#60a5fa' },
      { slug: 'plan',       name: 'Plan',       color: '#34d399' },
      { slug: 'implement',  name: 'Implement',  color: '#fbbf24' },
      { slug: 'review',     name: 'Review',     color: '#f472b6' },
      { slug: 'done',       name: 'Done',       color: '#22c55e' },
    ],
  };
}

// ─── YAML Parsing Helpers ─────────────────────────────────────────────────────

function parseAgentConfig(raw: Record<string, unknown>): Partial<AgentConfig> {
  const cfg: Partial<AgentConfig> = {};
  if (raw.model)          cfg.model          = raw.model          as AgentConfig['model'];
  if (raw.effort)         cfg.effort         = raw.effort         as AgentConfig['effort'];
  if (raw.permissionMode) cfg.permissionMode = raw.permissionMode as AgentConfig['permissionMode'];
  if (raw.verbosity)      cfg.verbosity      = raw.verbosity      as AgentConfig['verbosity'];
  return cfg;
}

function parseMcpServers(raw: unknown): Record<string, McpServerConfig> {
  if (!raw || typeof raw !== 'object') return {};
  const result: Record<string, McpServerConfig> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const v = val as Record<string, unknown>;
    if (v && typeof v.command === 'string') {
      result[key] = {
        command: v.command,
        args:    Array.isArray(v.args) ? v.args : undefined,
        env:     (v.env && typeof v.env === 'object') ? v.env as Record<string, string> : undefined,
      };
    }
  }
  return result;
}

function parseTools(raw: unknown): { allowed: string[]; disallowed: string[] } {
  const t = raw as Record<string, unknown> | undefined;
  return {
    allowed:    Array.isArray(t?.allowed)    ? t!.allowed    as string[] : [],
    disallowed: Array.isArray(t?.disallowed) ? t!.disallowed as string[] : [],
  };
}

// ─── Read a single .md file (returns '' if missing) ───────────────────────────

async function readMd(path: string): Promise<string> {
  try {
    const e = await exists(path);
    if (!e) return '';
    return await readTextFile(path);
  } catch {
    return '';
  }
}

// ─── Read a FlowState from its directory (projectPath = repo root) ────────────

async function readFlowState(projectPath: string, slug: string): Promise<FlowState> {
  const stateYaml = `${projectPath}/${STATES_DIR}/${slug}/state.yaml`;
  let raw: Record<string, unknown> = {};
  try {
    const e = await exists(stateYaml);
    if (e) raw = (yaml.load(await readTextFile(stateYaml)) as Record<string, unknown>) || {};
  } catch { /* treat as empty */ }

  const prompt        = await readMd(`${projectPath}/${STATES_DIR}/${slug}/prompt.md`);
  const triggerPrompt = await readMd(`${projectPath}/${STATES_DIR}/${slug}/trigger.md`);

  return {
    slug,
    name:          (raw.name  as string | undefined) || slug,
    color:         (raw.color as string | undefined) || '#6b7280',
    icon:           raw.icon  as string | undefined,
    agent:         raw.agent  ? parseAgentConfig(raw.agent as Record<string, unknown>) : undefined,
    agents:        Array.isArray(raw.agents)       ? raw.agents       as string[] : undefined,
    skills:        Array.isArray(raw.skills)       ? raw.skills       as string[] : undefined,
    mcpServers:    raw.mcpServers ? parseMcpServers(raw.mcpServers)                : undefined,
    tools:         raw.tools  ? parseTools(raw.tools) as FlowState['tools']       : undefined,
    requiredFiles: Array.isArray(raw.requiredFiles) ? raw.requiredFiles as string[]: undefined,
    prompt:        prompt        || undefined,
    triggerPrompt: triggerPrompt || undefined,
  };
}

// ─── Read a Flow from projectPath (repo root) — reads .oncraft/flow.yaml ─────

// Internal type to carry flowMd during loading without polluting the Flow interface
type FlowWithMd = Flow & { _flowMd?: string };

async function readFlowFromDir(projectPath: string): Promise<FlowWithMd | null> {
  const flowYaml = `${projectPath}/${FLOW_FILE}`;
  try {
    const e = await exists(flowYaml);
    if (!e) return null;
    const content = await readTextFile(flowYaml);
    const raw = (yaml.load(content) as Record<string, unknown>) || {};

    const stateOrder: string[] = Array.isArray(raw.stateOrder) ? raw.stateOrder as string[] : [];
    const states: FlowState[] = [];
    for (const slug of stateOrder) {
      states.push(await readFlowState(projectPath, slug));
    }

    const flowMd = await readMd(`${projectPath}/${ONCRAFT_DIR}/flow.md`);

    return {
      name:       (raw.name as string | undefined) || 'Flow',
      preset:      raw.preset as string | undefined,
      agent:      raw.agent ? parseAgentConfig(raw.agent as Record<string, unknown>) as AgentConfig : {},
      agents:     Array.isArray(raw.agents) ? raw.agents as string[] : [],
      skills:     Array.isArray(raw.skills) ? raw.skills as string[] : [],
      mcpServers: parseMcpServers(raw.mcpServers),
      tools:      parseTools(raw.tools),
      stateOrder,
      states,
      _flowMd: flowMd || undefined,
    };
  } catch {
    return null;
  }
}

// ─── Read a Flow from a preset directory (presetDir is the root, no .oncraft/) ─

async function readFlowFromPresetDir(presetDir: string): Promise<FlowWithMd | null> {
  const flowYaml = `${presetDir}/flow.yaml`;
  try {
    const e = await exists(flowYaml);
    if (!e) return null;
    const content = await readTextFile(flowYaml);
    const raw = (yaml.load(content) as Record<string, unknown>) || {};

    const stateOrder: string[] = Array.isArray(raw.stateOrder) ? raw.stateOrder as string[] : [];
    const states: FlowState[] = [];

    for (const slug of stateOrder) {
      const stateYaml = `${presetDir}/states/${slug}/state.yaml`;
      let sRaw: Record<string, unknown> = {};
      try {
        const se = await exists(stateYaml);
        if (se) sRaw = (yaml.load(await readTextFile(stateYaml)) as Record<string, unknown>) || {};
      } catch { /* treat as empty */ }

      states.push({
        slug,
        name:          (sRaw.name  as string) || slug,
        color:         (sRaw.color as string) || '#6b7280',
        icon:           sRaw.icon  as string | undefined,
        agent:         sRaw.agent  ? parseAgentConfig(sRaw.agent as Record<string, unknown>) : undefined,
        agents:        Array.isArray(sRaw.agents)       ? sRaw.agents       as string[] : undefined,
        skills:        Array.isArray(sRaw.skills)       ? sRaw.skills       as string[] : undefined,
        mcpServers:    sRaw.mcpServers ? parseMcpServers(sRaw.mcpServers)                : undefined,
        tools:         sRaw.tools  ? parseTools(sRaw.tools) as FlowState['tools']        : undefined,
        requiredFiles: Array.isArray(sRaw.requiredFiles) ? sRaw.requiredFiles as string[] : undefined,
        prompt:        (await readMd(`${presetDir}/states/${slug}/prompt.md`))  || undefined,
        triggerPrompt: (await readMd(`${presetDir}/states/${slug}/trigger.md`)) || undefined,
      });
    }

    return {
      name:       (raw.name as string) || 'Preset',
      agent:      raw.agent ? parseAgentConfig(raw.agent as Record<string, unknown>) as AgentConfig : {},
      agents:     Array.isArray(raw.agents) ? raw.agents as string[] : [],
      skills:     Array.isArray(raw.skills) ? raw.skills as string[] : [],
      mcpServers: parseMcpServers(raw.mcpServers),
      tools:      parseTools(raw.tools),
      stateOrder,
      states,
      _flowMd: (await readMd(`${presetDir}/flow.md`)) || undefined,
    };
  } catch {
    return null;
  }
}

// ─── Merge helpers ────────────────────────────────────────────────────────────

function mergeAgentConfig(base: Partial<AgentConfig>, override: Partial<AgentConfig>): AgentConfig {
  return { ...base, ...override } as AgentConfig;
}

function mergeMcpServers(
  base: Record<string, McpServerConfig>,
  override: Record<string, McpServerConfig>,
): Record<string, McpServerConfig> {
  return { ...base, ...override };
}

function mergeTools(
  base: { allowed: string[]; disallowed: string[] },
  override: { allowed?: string[]; disallowed?: string[] },
): { allowed: string[]; disallowed: string[] } {
  return {
    allowed:    [...new Set([...base.allowed,    ...(override.allowed    || [])])],
    disallowed: [...new Set([...base.disallowed, ...(override.disallowed || [])])],
  };
}

function mergeState(base: FlowState, override: Partial<FlowState>): FlowState {
  return {
    ...base,
    ...override,
    slug:  base.slug,
    agent: override.agent
      ? mergeAgentConfig(base.agent || {}, override.agent)
      : base.agent,
    agents:     [...new Set([...(base.agents || []),     ...(override.agents     || [])])],
    skills:     [...new Set([...(base.skills || []),     ...(override.skills     || [])])],
    mcpServers: mergeMcpServers(base.mcpServers || {}, override.mcpServers || {}),
    tools:      override.tools
      ? mergeTools(
          { allowed: base.tools?.allowed ?? [], disallowed: base.tools?.disallowed ?? [] },
          { allowed: override.tools.allowed ?? [], disallowed: override.tools.disallowed ?? [] },
        )
      : base.tools,
    prompt:        override.prompt        ?? base.prompt,
    triggerPrompt: override.triggerPrompt ?? base.triggerPrompt,
  };
}

// ─── Preset resolution ────────────────────────────────────────────────────────

async function resolvePreset(presetName: string): Promise<FlowWithMd | null> {
  try {
    const home = await homeDir();
    return await readFlowFromPresetDir(`${home}/.oncraft/presets/${presetName}`);
  } catch {
    return null;
  }
}

async function mergeWithPreset(project: FlowWithMd, presetName: string): Promise<FlowWithMd> {
  const preset = await resolvePreset(presetName);
  if (!preset) return project;

  const stateOrder = project.stateOrder.length > 0 ? project.stateOrder : preset.stateOrder;
  const states: FlowState[] = [];

  for (const slug of stateOrder) {
    const presetState  = preset.states.find(s => s.slug === slug);
    const projectState = project.states.find(s => s.slug === slug);
    if (projectState && presetState) {
      states.push(mergeState(presetState, projectState));
    } else if (projectState) {
      states.push(projectState);
    } else if (presetState) {
      states.push(presetState);
    } else {
      states.push({ slug, name: slug, color: '#6b7280' });
    }
  }

  const flowMd = project._flowMd ?? preset._flowMd;

  return {
    name:       project.name || preset.name,
    preset:     presetName,
    agent:      mergeAgentConfig(preset.agent || {}, project.agent || {}),
    agents:     [...new Set([...(preset.agents || []), ...(project.agents || [])])],
    skills:     [...new Set([...(preset.skills || []), ...(project.skills || [])])],
    mcpServers: mergeMcpServers(preset.mcpServers || {}, project.mcpServers || {}),
    tools:      mergeTools(preset.tools || { allowed: [], disallowed: [] }, project.tools || {}),
    stateOrder,
    states,
    _flowMd: flowMd,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface LoadFlowResult {
  flow: Flow;
  flowMd: string;
  warnings: FlowWarning[];
}

export async function loadFlow(projectPath: string): Promise<LoadFlowResult> {
  const warnings: FlowWarning[] = [];

  // Read project flow
  let project = await readFlowFromDir(projectPath);

  if (!project) {
    // No .oncraft/flow.yaml — bootstrap with swe-basic preset
    const onCraftDir = `${projectPath}/${ONCRAFT_DIR}`;
    try {
      await mkdir(onCraftDir, { recursive: true });
      await writeTextFile(
        `${projectPath}/${FLOW_FILE}`,
        yaml.dump({ preset: 'swe-basic' }, { lineWidth: 80 }),
      );
      if (import.meta.dev) console.log('[OnCraft] bootstrapped .oncraft/flow.yaml with preset: swe-basic');
    } catch (err) {
      if (import.meta.dev) console.warn('[OnCraft] could not write default flow.yaml:', err);
    }
    project = await readFlowFromDir(projectPath);
  }

  if (!project) {
    // Absolute fallback (e.g. FS write failed)
    warnings.push({ scope: 'flow', message: 'Could not initialise .oncraft/flow.yaml — using in-memory defaults' });
    return { flow: makeDefaultFlow(), flowMd: '', warnings };
  }

  // Resolve preset if referenced
  let merged: FlowWithMd = project;
  if (project.preset) {
    const presetExists = await resolvePreset(project.preset);
    if (!presetExists) {
      warnings.push({ scope: 'flow', message: `Preset "${project.preset}" not found at ~/.oncraft/presets/${project.preset}` });
    }
    merged = await mergeWithPreset(project, project.preset);
  }

  // Validate states
  for (const state of merged.states) {
    if (!state.name) {
      warnings.push({ scope: 'state', stateSlug: state.slug, message: `State "${state.slug}" has no name` });
    }
  }

  const { _flowMd: extractedFlowMd, ...cleanFlow } = merged;
  const flowMd = extractedFlowMd || '';

  return { flow: cleanFlow as Flow, flowMd, warnings };
}

// ─── Config resolution (merge Flow + FlowState for a given slug) ──────────────

export function resolveConfigForState(
  flow: Flow,
  stateSlug: string,
  flowMd: string,
): {
  agent: AgentConfig;
  agents: string[];
  skills: string[];
  mcpServers: Record<string, McpServerConfig>;
  allowedTools: string[];
  disallowedTools: string[];
  systemPromptAppend: string;
} {
  const state = flow.states.find(s => s.slug === stateSlug);

  const agent: AgentConfig = { ...flow.agent, ...(state?.agent || {}) };

  const agents = [...new Set([...flow.agents, ...(state?.agents || [])])];
  const skills = [...new Set([...flow.skills, ...(state?.skills || [])])];

  const mcpServers = mergeMcpServers(flow.mcpServers, state?.mcpServers || {});

  const merged = mergeTools(flow.tools, state?.tools || {});
  // disallowed wins over allowed
  const allowedTools    = merged.allowed.filter(t => !merged.disallowed.includes(t));
  const disallowedTools = merged.disallowed;

  const parts = [flowMd, state?.prompt].filter(Boolean);
  const systemPromptAppend = parts.join('\n\n---\n\n');

  return { agent, agents, skills, mcpServers, allowedTools, disallowedTools, systemPromptAppend };
}

// ─── Bundled preset installation ──────────────────────────────────────────────

async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  const entries = await readDir(src);
  for (const entry of entries) {
    const srcPath  = `${src}/${entry.name}`;
    const destPath = `${dest}/${entry.name}`;
    if (entry.isDirectory) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      await copyFile(srcPath, destPath);
    }
  }
}

export async function installBundledPresets(): Promise<void> {
  try {
    const home   = await homeDir();
    const resDir = await resourceDir();

    for (const presetName of BUNDLED_PRESETS) {
      const destDir    = `${home}/.oncraft/presets/${presetName}`;
      const destExists = await exists(destDir);
      if (destExists) continue; // already installed — never overwrite user customizations

      // In production, presets are bundled inside resourceDir/presets/.
      // In dev, resourceDir points to src-tauri/ and the presets live at ../presets/
      // relative to that. Try both locations.
      let srcDir = await pathJoin(resDir, 'presets', presetName);
      let srcExists = await exists(srcDir);

      if (!srcExists) {
        // Dev fallback: resourceDir is src-tauri/, presets are at ../presets/
        srcDir = await pathJoin(resDir, '..', 'presets', presetName);
        srcExists = await exists(srcDir);
      }

      if (!srcExists) {
        if (import.meta.dev) console.warn('[OnCraft] bundled preset not found at:', srcDir);
        continue;
      }

      // Ensure parent directories exist
      await mkdir(`${home}/.oncraft/presets`, { recursive: true });

      await copyDirRecursive(srcDir, destDir);
      if (import.meta.dev) console.log('[OnCraft] installed bundled preset:', presetName);
    }
  } catch (err) {
    // Non-fatal: app works without presets
    if (import.meta.dev) console.warn('[OnCraft] installBundledPresets failed:', err);
  }
}
