# Flow System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `ProjectConfig` (columns + pipelines) with a rich Flow system that injects contextual agent configuration (system prompt, tools, agents, MCPs) into every Claude session based on the card's board position.

**Architecture:** A new `flow-loader.ts` service reads `.oncraft/flow.yaml` + `states/*/state.yaml` + `*.md` files from disk, resolves presets from `~/.oncraft/presets/`, and merges all layers (Preset → Flow → FlowState → Card). A new `useFlowStore` Pinia store replaces `usePipelinesStore` and exposes the resolved Flow to components. `claude-process.ts` receives the composed config and passes it through the sidecar protocol to `agent-bridge.ts`, which passes it to the SDK's `query()`. The sidecar remains a thin pass-through; all merge/compose logic stays in the frontend.

**Tech Stack:** TypeScript, Vue 3, Pinia, Nuxt 4, `js-yaml`, `@tauri-apps/plugin-fs`, `@anthropic-ai/claude-agent-sdk` (sidecar)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `app/types/index.ts` | Modify | Add `Flow`, `FlowState`, `AgentConfig`, `McpServerConfig`, `FlowWarning` types; update `TemplateContext` |
| `app/services/flow-loader.ts` | **Create** | Read/parse/merge Flow config from filesystem; preset resolution; migration from `config.yaml` |
| `app/services/agent-resolver.ts` | **Create** | Resolve agent names → `AgentDefinition` objects by scanning `.claude/agents/` and plugin cache |
| `app/services/template-engine.ts` | Modify | Extend regex to support 3-level dot-path access (`session.files.plan`) |
| `app/stores/flow.ts` | **Create** | Pinia store: load Flow, expose getters, track warnings, replace `usePipelinesStore` |
| `app/stores/pipelines.ts` | Modify | Deprecate/thin-wrap around `useFlowStore` for backward compat during transition |
| `app/services/claude-process.ts` | Modify | Add new Flow fields to `StartCommand`; `spawnSession`/`sendStart` accept resolved config |
| `app/stores/sessions.ts` | Modify | Pass resolved Flow config (system prompt, tools, agents, MCPs) when calling `spawnSession`/`sendStart`; fire trigger prompt on card move |
| `src-sidecar/agent-bridge.ts` | Modify | Accept new `start` command fields; pass them to `query()` |
| `app/components/KanbanColumn.vue` | Modify | Get color/name/icon from `FlowState` via store; show warnings badge |
| `app/components/KanbanBoard.vue` | Modify | Use `stateOrder` from `useFlowStore` instead of `usePipelinesStore` columns |
| `app/components/KanbanColumn.vue` | Modify (drag) | `requiredFiles` gate and trigger prompt on card move (drag handled here, not in KanbanCard) |
| `app/components/KanbanCard.vue` | Modify | Show "Unknown column" badge for orphaned slugs |
| `app/app.vue` | Modify | Ensure `useFlowStore().loadForProject()` is called on project open |
| `app/components/TabBar.vue` | Modify | Update `usePipelinesStore` usage to `useFlowStore` |
| `app/components/ProjectSettings.vue` | Modify | Replace pipeline/column editors with Flow info + open-in-editor action |

---

## Task 1: New Types

**Files:**
- Modify: `app/types/index.ts`

Add `McpServerConfig`, `AgentConfig`, `FlowState`, `Flow`, `FlowWarning` interfaces and update `TemplateContext`.

- [ ] **Step 1: Add types to `app/types/index.ts`**

Add after the existing `ColumnConfig` block (keep `ColumnConfig` for now — removed in Task 9):

```typescript
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AgentConfig {
  model?: ModelAlias;
  effort?: EffortLevel;
  permissionMode?: PermissionMode;
  verbosity?: VerbosityLevel;
}

export interface FlowState {
  slug: string;           // directory name — maps to Card.columnName
  name: string;           // display name
  color: string;
  icon?: string;          // Iconify name e.g. "heroicons:magnifying-glass"
  agent?: Partial<AgentConfig>;
  agents?: string[];      // agent names → resolved at runtime
  skills?: string[];
  mcpServers?: Record<string, McpServerConfig>;
  tools?: {
    allowed?: string[];
    disallowed?: string[];
  };
  requiredFiles?: string[];
  prompt?: string;        // loaded from prompt.md
  triggerPrompt?: string; // loaded from trigger.md
}

export interface Flow {
  name: string;
  preset?: string;
  agent: AgentConfig;
  agents: string[];
  skills: string[];
  mcpServers: Record<string, McpServerConfig>;
  tools: {
    allowed: string[];
    disallowed: string[];
  };
  stateOrder: string[];
  states: FlowState[];    // populated from filesystem
}

export interface FlowWarning {
  scope: 'flow' | 'state';
  stateSlug?: string;
  message: string;
}
```

- [ ] **Step 2: Update `TemplateContext` to support `session.files.*`**

Replace the existing `TemplateContext` interface:

```typescript
export interface TemplateContext {
  session: {
    name: string;
    id: string;
    files: Record<string, string>;  // label → file path
  };
  project: { path: string; name: string };
  card: { description: string };
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/albert.puigsech/Develop/github.com/apuigsech/oncraft/.claude/worktrees/better-flows
pnpm nuxt typecheck 2>&1 | head -40
```

Expected: errors only from files that *use* the old `TemplateContext` shape (we'll fix those in later tasks). No errors in `types/index.ts` itself.

- [ ] **Step 4: Commit**

```bash
git add app/types/index.ts
git commit -m "feat(flow): add Flow, FlowState, AgentConfig, McpServerConfig types"
```

---

## Task 2: Template Engine — 3-Level Dot-Path Support

**Files:**
- Modify: `app/services/template-engine.ts`

The current regex `/\{\{(\w+)\.(\w+)\}\}/g` only handles `{{ a.b }}`. We need `{{ a.b.c }}` for `session.files.plan`.

- [ ] **Step 1: Replace `template-engine.ts` with dot-path traversal**

```typescript
// app/services/template-engine.ts
import type { TemplateContext } from '~/types';

function getNestedValue(obj: unknown, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (current === null || current === undefined) return undefined;
  return String(current);
}

export function resolveTemplate(
  template: string,
  context: TemplateContext,
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path) => {
    const value = getNestedValue(context, path);
    return value !== undefined ? value : _match;
  });
}
```

- [ ] **Step 2: Update callers of `resolveTemplate` to remove the `column` key**

`app/stores/sessions.ts` currently passes `column: { name: card.columnName }`. Remove that key and pass `files` instead:

In `sessions.ts`, find the `columnPrompt` block and replace the `resolveTemplate` call context:

```typescript
// OLD (to remove):
columnPrompt = resolveTemplate(colConfig.prompt, {
  session: { name: card.name, id: card.sessionId },
  project: { path: project.path, name: project.name },
  card: { description: card.description },
  column: { name: card.columnName },
});

// Will be fully replaced in Task 6. For now, just ensure it compiles.
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm nuxt typecheck 2>&1 | head -40
```

Expected: no errors in `template-engine.ts`. Errors in `sessions.ts` are acceptable (fixed in Task 6).

- [ ] **Step 4: Commit**

```bash
git add app/services/template-engine.ts
git commit -m "feat(flow): extend template engine to support 3-level dot-path access"
```

---

## Task 3: `flow-loader.ts` — Read, Parse, Merge Flow from Filesystem

**Files:**
- Create: `app/services/flow-loader.ts`

This is the core service. It reads `.oncraft/flow.yaml`, scans `states/*/state.yaml`, reads `*.md` prompt files, resolves presets from `~/.oncraft/presets/`, and applies merge rules. It also auto-migrates `config.yaml` → new structure.

- [ ] **Step 1: Create `app/services/flow-loader.ts`**

```typescript
// app/services/flow-loader.ts
import { readTextFile, writeTextFile, exists, mkdir, rename } from '@tauri-apps/plugin-fs';
import { homeDir } from '@tauri-apps/api/path';
import * as yaml from 'js-yaml';
import type { Flow, FlowState, AgentConfig, McpServerConfig } from '~/types';

const ONCRAFT_DIR = '.oncraft';
const FLOW_FILE   = `${ONCRAFT_DIR}/flow.yaml`;
const LEGACY_CONFIG = `${ONCRAFT_DIR}/config.yaml`;
const LEGACY_BACKUP = `${ONCRAFT_DIR}/config.yaml.bak`;

// All paths below are resolved as: ${projectPath}/${relative}
// readFlowState and readFlowFromDir always receive projectPath (repo root), never an inner dir.

// ─── Default Flow (used when no config exists) ────────────────────────────────

export const DEFAULT_FLOW_STATES: Omit<FlowState, 'prompt' | 'triggerPrompt'>[] = [
  { slug: 'brainstorm', name: 'Brainstorm', color: '#a78bfa' },
  { slug: 'specify',    name: 'Specify',    color: '#60a5fa' },
  { slug: 'plan',       name: 'Plan',       color: '#34d399' },
  { slug: 'implement',  name: 'Implement',  color: '#fbbf24' },
  { slug: 'review',     name: 'Review',     color: '#f472b6' },
  { slug: 'done',       name: 'Done',       color: '#22c55e' },
];

function makeDefaultFlow(): Flow {
  return {
    name: 'Default',
    agent: { model: 'sonnet', effort: 'high', permissionMode: 'default' },
    agents: [],
    skills: [],
    mcpServers: {},
    tools: { allowed: [], disallowed: [] },
    stateOrder: DEFAULT_FLOW_STATES.map(s => s.slug),
    states: DEFAULT_FLOW_STATES.map(s => ({ ...s })),
  };
}

// ─── YAML Parsing Helpers ─────────────────────────────────────────────────────

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parseAgentConfig(raw: Record<string, unknown>): Partial<AgentConfig> {
  const cfg: Partial<AgentConfig> = {};
  if (raw.model)          cfg.model          = raw.model as AgentConfig['model'];
  if (raw.effort)         cfg.effort         = raw.effort as AgentConfig['effort'];
  if (raw.permissionMode) cfg.permissionMode = raw.permissionMode as AgentConfig['permissionMode'];
  if (raw.verbosity)      cfg.verbosity      = raw.verbosity as AgentConfig['verbosity'];
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
        args: Array.isArray(v.args) ? v.args : undefined,
        env: (v.env && typeof v.env === 'object') ? v.env as Record<string, string> : undefined,
      };
    }
  }
  return result;
}

function parseTools(raw: unknown): { allowed: string[]; disallowed: string[] } {
  const t = raw as Record<string, unknown> | undefined;
  return {
    allowed:    Array.isArray(t?.allowed)    ? t!.allowed    : [],
    disallowed: Array.isArray(t?.disallowed) ? t!.disallowed : [],
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

// ─── Read a FlowState from its directory ─────────────────────────────────────

// projectPath is always the repo root (e.g. /home/user/myproject)
// States live at ${projectPath}/.oncraft/states/${slug}/
async function readFlowState(projectPath: string, slug: string): Promise<FlowState | null> {
  const stateYaml = `${projectPath}/${ONCRAFT_DIR}/states/${slug}/state.yaml`;
  let raw: Record<string, unknown> = {};
  try {
    const e = await exists(stateYaml);
    if (e) {
      const content = await readTextFile(stateYaml);
      raw = (yaml.load(content) as Record<string, unknown>) || {};
    }
  } catch { /* treat as empty */ }

  const name  = (raw.name  as string | undefined) || slug;
  const color = (raw.color as string | undefined) || '#6b7280';
  const icon  = raw.icon  as string | undefined;

  const prompt        = await readMd(`${projectPath}/${ONCRAFT_DIR}/states/${slug}/prompt.md`);
  const triggerPrompt = await readMd(`${projectPath}/${ONCRAFT_DIR}/states/${slug}/trigger.md`);

  return {
    slug,
    name,
    color,
    icon,
    agent:        raw.agent        ? parseAgentConfig(raw.agent as Record<string, unknown>) : undefined,
    agents:       Array.isArray(raw.agents) ? raw.agents as string[] : undefined,
    skills:       Array.isArray(raw.skills) ? raw.skills as string[] : undefined,
    mcpServers:   raw.mcpServers   ? parseMcpServers(raw.mcpServers) : undefined,
    tools:        raw.tools        ? parseTools(raw.tools) as FlowState['tools'] : undefined,
    requiredFiles: Array.isArray(raw.requiredFiles) ? raw.requiredFiles as string[] : undefined,
    prompt:        prompt        || undefined,
    triggerPrompt: triggerPrompt || undefined,
  };
}

// ─── Read a Flow from a directory (project or preset) ────────────────────────

// projectPath = repo root. Flow lives at ${projectPath}/.oncraft/flow.yaml
// For preset dirs, the caller adjusts: presetDir is already a full path and we use a different helper.
async function readFlowFromDir(projectPath: string): Promise<Flow | null> {
  const flowYaml = `${projectPath}/${FLOW_FILE}`;
  try {
    const e = await exists(flowYaml);
    if (!e) return null;
    const content = await readTextFile(flowYaml);
    const raw = (yaml.load(content) as Record<string, unknown>) || {};

    const stateOrder: string[] = Array.isArray(raw.stateOrder) ? raw.stateOrder as string[] : [];
    const states: FlowState[] = [];
    for (const slug of stateOrder) {
      const state = await readFlowState(projectPath, slug);
      if (state) states.push(state);
    }

    const flowMd = await readMd(`${projectPath}/${ONCRAFT_DIR}/flow.md`);

    return {
      name:       (raw.name as string | undefined) || 'Flow',
      preset:     raw.preset as string | undefined,
      agent:      raw.agent ? parseAgentConfig(raw.agent as Record<string, unknown>) as AgentConfig : {},
      agents:     Array.isArray(raw.agents) ? raw.agents as string[] : [],
      skills:     Array.isArray(raw.skills) ? raw.skills as string[] : [],
      mcpServers: parseMcpServers(raw.mcpServers),
      tools:      parseTools(raw.tools),
      stateOrder,
      states,
      // Store flow.md content temporarily for merge (not part of Flow interface; used below)
      _flowMd: flowMd || undefined,
    } as Flow & { _flowMd?: string };
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

function mergeStateYaml(
  base: FlowState,
  override: Partial<FlowState>,
): FlowState {
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
      ? mergeTools(base.tools || { allowed: [], disallowed: [] }, override.tools)
      : base.tools,
    // prompt.md and trigger.md: replacement semantics (override wins if present)
    prompt:        override.prompt        ?? base.prompt,
    triggerPrompt: override.triggerPrompt ?? base.triggerPrompt,
  };
}

// ─── Preset merge ─────────────────────────────────────────────────────────────

// Presets have a self-contained directory: flow.yaml + states/ at the top level (no .oncraft/ prefix)
// So we use a separate reader that treats presetDir as the root directly.
async function readFlowFromPresetDir(presetDir: string): Promise<Flow | null> {
  const flowYaml = `${presetDir}/flow.yaml`;
  try {
    const e = await exists(flowYaml);
    if (!e) return null;
    const content = await readTextFile(flowYaml);
    const raw = (yaml.load(content) as Record<string, unknown>) || {};

    const stateOrder: string[] = Array.isArray(raw.stateOrder) ? raw.stateOrder as string[] : [];
    const states: FlowState[] = [];
    for (const slug of stateOrder) {
      // Preset states live at: presetDir/states/<slug>/state.yaml
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
        agents:        Array.isArray(sRaw.agents) ? sRaw.agents as string[] : undefined,
        skills:        Array.isArray(sRaw.skills) ? sRaw.skills as string[] : undefined,
        mcpServers:    sRaw.mcpServers ? parseMcpServers(sRaw.mcpServers) : undefined,
        tools:         sRaw.tools  ? parseTools(sRaw.tools) as FlowState['tools'] : undefined,
        requiredFiles: Array.isArray(sRaw.requiredFiles) ? sRaw.requiredFiles as string[] : undefined,
        prompt:        (await readMd(`${presetDir}/states/${slug}/prompt.md`))   || undefined,
        triggerPrompt: (await readMd(`${presetDir}/states/${slug}/trigger.md`))  || undefined,
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
    } as Flow & { _flowMd?: string };
  } catch {
    return null;
  }
}

async function resolvePreset(presetName: string): Promise<Flow | null> {
  try {
    const home = await homeDir();
    const presetDir = `${home}/.oncraft/presets/${presetName}`;
    return await readFlowFromPresetDir(presetDir);
  } catch {
    return null;
  }
}

async function mergeWithPreset(project: Flow, presetName: string): Promise<Flow> {
  const preset = await resolvePreset(presetName);
  if (!preset) return project;

  // stateOrder: project's wins if defined, else preset's
  const stateOrder = project.stateOrder.length > 0 ? project.stateOrder : preset.stateOrder;

  // For each state in stateOrder, merge preset state + project state
  const states: FlowState[] = [];
  for (const slug of stateOrder) {
    const presetState  = preset.states.find(s => s.slug === slug);
    const projectState = project.states.find(s => s.slug === slug);

    if (projectState && presetState) {
      states.push(mergeStateYaml(presetState, projectState));
    } else if (projectState) {
      states.push(projectState);
    } else if (presetState) {
      states.push(presetState);
    } else {
      // Unknown slug — create minimal placeholder with warning
      states.push({ slug, name: slug, color: '#6b7280' });
    }
  }

  // flow.md: project wins if it has one
  const merged = preset as Flow & { _flowMd?: string };
  const proj   = project as Flow & { _flowMd?: string };
  const flowMd = proj._flowMd ?? merged._flowMd;

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
  } as Flow & { _flowMd?: string };
}

// ─── Legacy migration ─────────────────────────────────────────────────────────

async function migrateLegacyConfig(projectPath: string): Promise<void> {
  const legacyPath = `${projectPath}/${LEGACY_CONFIG}`;
  const backupPath = `${projectPath}/${LEGACY_BACKUP}`;
  const flowYaml   = `${projectPath}/${FLOW_FILE}`;

  if (import.meta.dev) console.log('[OnCraft] migrating legacy config.yaml → flow structure');

  try {
    const content = await readTextFile(legacyPath);
    const raw = (yaml.load(content) as Record<string, unknown>) || {};
    const columns = (raw.columns as Array<Record<string, unknown>>) || [];
    const pipelines = (raw.pipelines as Array<Record<string, unknown>>) || [];

    // Build stateOrder and state directories
    const stateOrder: string[] = [];
    for (const col of columns) {
      const slug = slugify(col.name as string);
      stateOrder.push(slug);

      const stateDir = `${projectPath}/${STATES_DIR}/${slug}`;
      try { await mkdir(stateDir, { recursive: true }); } catch { /* exists */ }

      const stateYaml = {
        name:  col.name,
        color: col.color || '#6b7280',
        ...(col.inputs  ? { inputs:  col.inputs  } : {}),
        ...(col.outputs ? { outputs: col.outputs } : {}),
      };
      await writeTextFile(`${stateDir}/state.yaml`, yaml.dump(stateYaml));

      // Write column prompt as prompt.md if it exists
      if (col.prompt && typeof col.prompt === 'string') {
        await writeTextFile(`${stateDir}/prompt.md`, col.prompt);
      }
    }

    // Build trigger.md for each target state from pipelines
    // Only the first pipeline targeting a state is used
    const usedTargets = new Set<string>();
    for (const pipe of pipelines) {
      const toSlug = slugify(pipe.to as string);
      if (!usedTargets.has(toSlug) && pipe.prompt) {
        usedTargets.add(toSlug);
        const stateDir = `${projectPath}/${STATES_DIR}/${toSlug}`;
        try { await mkdir(stateDir, { recursive: true }); } catch { /* exists */ }
        await writeTextFile(`${stateDir}/trigger.md`, pipe.prompt as string);
      }
    }

    // Write flow.yaml
    const flowConfig = {
      name: 'Migrated Flow',
      stateOrder,
      agent: { model: 'sonnet', effort: 'high', permissionMode: 'default' },
    };
    const onCraftDir = `${projectPath}/${ONCRAFT_DIR}`;
    try { await mkdir(onCraftDir, { recursive: true }); } catch { /* exists */ }
    await writeTextFile(flowYaml, yaml.dump(flowConfig));

    // Backup original config
    await rename(legacyPath, backupPath);
    if (import.meta.dev) console.log('[OnCraft] migration complete, backup at', LEGACY_BACKUP);

  } catch (err) {
    if (import.meta.dev) console.warn('[OnCraft] migration failed:', err);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface LoadFlowResult {
  flow: Flow;
  flowMd: string;
  warnings: import('~/types').FlowWarning[];
}

export async function loadFlow(projectPath: string): Promise<LoadFlowResult> {
  const warnings: import('~/types').FlowWarning[] = [];

  // Auto-migrate legacy config.yaml if needed
  const flowYamlPath = `${projectPath}/${FLOW_FILE}`;
  const legacyPath   = `${projectPath}/${LEGACY_CONFIG}`;
  const backupPath   = `${projectPath}/${LEGACY_BACKUP}`;

  try {
    const hasFlowYaml = await exists(flowYamlPath);
    const hasLegacy   = await exists(legacyPath);
    const hasBackup   = await exists(backupPath);

    if (!hasFlowYaml && hasLegacy && !hasBackup) {
      await migrateLegacyConfig(projectPath);
    }
  } catch { /* non-fatal */ }

  // Read project flow — pass projectPath (repo root); flow-loader constructs .oncraft/ paths internally
  let project = await readFlowFromDir(projectPath);

  if (!project) {
    // No flow config at all — create defaults
    const defaults = makeDefaultFlow();
    warnings.push({ scope: 'flow', message: 'No .oncraft/flow.yaml found, using defaults' });
    return { flow: defaults, flowMd: '', warnings };
  }

  // Resolve preset if referenced
  let merged: Flow & { _flowMd?: string } = project as Flow & { _flowMd?: string };
  if (project.preset) {
    merged = (await mergeWithPreset(project, project.preset)) as Flow & { _flowMd?: string };
    const presetExists = await resolvePreset(project.preset);
    if (!presetExists) {
      warnings.push({ scope: 'flow', message: `Preset "${project.preset}" not found at ~/.oncraft/presets/${project.preset}` });
    }
  }

  // Validate states
  for (const state of merged.states) {
    if (!state.name) {
      warnings.push({ scope: 'state', stateSlug: state.slug, message: `State "${state.slug}" has no name` });
    }
  }

  // Extract flowMd separately — it is never stored on the Flow object itself.
  // _flowMd is a loader-internal transport field attached by readFlowFromDir/readFlowFromPresetDir.
  const { _flowMd: extractedFlowMd, ...cleanFlow } = merged as Flow & { _flowMd?: string };
  const flowMd = extractedFlowMd || '';

  return { flow: cleanFlow as Flow, flowMd, warnings };
}

export async function saveFlowYaml(projectPath: string, flowYaml: Record<string, unknown>): Promise<void> {
  const dir = `${projectPath}/${ONCRAFT_DIR}`;
  try { await mkdir(dir, { recursive: true }); } catch { /* exists */ }
  await writeTextFile(`${projectPath}/${FLOW_FILE}`, yaml.dump(flowYaml, { lineWidth: 120 }));
}

// ─── Config resolution (merge Flow + FlowState layers for a given slug) ───────

export function resolveConfigForState(
  flow: Flow,
  stateSlug: string,
  flowMd: string,
): {
  agent: import('~/types').AgentConfig;
  agents: string[];
  skills: string[];
  mcpServers: Record<string, McpServerConfig>;
  allowedTools: string[];
  disallowedTools: string[];
  systemPromptAppend: string;
} {
  const state = flow.states.find(s => s.slug === stateSlug);

  // Merge agent config: Flow defaults → FlowState override
  const agent: import('~/types').AgentConfig = {
    ...flow.agent,
    ...(state?.agent || {}),
  };

  // Additive merge: agents, skills
  const agents = [...new Set([...flow.agents, ...(state?.agents || [])])];
  const skills = [...new Set([...flow.skills, ...(state?.skills || [])])];

  // Additive merge: MCPs (state wins on same name)
  const mcpServers = mergeMcpServers(flow.mcpServers, state?.mcpServers || {});

  // Additive merge: tools (disallowed wins over allowed)
  const mergedTools = mergeTools(flow.tools, state?.tools || {});
  const { allowed: allowedTools, disallowed: disallowedTools } = mergedTools;
  // Disallowed wins: remove from allowed
  const finalAllowed = allowedTools.filter(t => !disallowedTools.includes(t));

  // System prompt: flow.md + state prompt.md
  const parts = [flowMd, state?.prompt].filter(Boolean);
  const systemPromptAppend = parts.join('\n\n---\n\n');

  return { agent, agents, skills, mcpServers, allowedTools: finalAllowed, disallowedTools, systemPromptAppend };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm nuxt typecheck 2>&1 | grep -E "flow-loader|error TS" | head -30
```

Expected: no errors in `flow-loader.ts`.

- [ ] **Step 3: Commit**

```bash
git add app/services/flow-loader.ts
git commit -m "feat(flow): add flow-loader service with filesystem parsing, preset merge, legacy migration"
```

---

## Task 4: `agent-resolver.ts` — Resolve Agent Names to AgentDefinitions

**Files:**
- Create: `app/services/agent-resolver.ts`

Scans `.claude/agents/`, `~/.claude/agents/`, and the plugin cache for `.md` files matching the agent name.

- [ ] **Step 1: Create `app/services/agent-resolver.ts`**

```typescript
// app/services/agent-resolver.ts
import { readTextFile, exists } from '@tauri-apps/plugin-fs';
import { homeDir } from '@tauri-apps/api/path';
import * as yaml from 'js-yaml';

export interface ResolvedAgent {
  name: string;
  description: string;
  prompt: string;
  model?: string;
  tools?: string[];
  disallowedTools?: string[];
  skills?: string[];
  maxTurns?: number;
}

async function tryReadAgentMd(path: string): Promise<ResolvedAgent | null> {
  try {
    const e = await exists(path);
    if (!e) return null;
    const content = await readTextFile(path);

    // Parse YAML frontmatter between --- delimiters
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;

    const frontmatter = (yaml.load(match[1]) as Record<string, unknown>) || {};
    const body = match[2].trim();

    return {
      name:           (frontmatter.name        as string)   || '',
      description:    (frontmatter.description as string)   || '',
      model:          (frontmatter.model       as string)   || undefined,
      prompt:         body,
      tools:          Array.isArray(frontmatter.tools)           ? frontmatter.tools           : undefined,
      disallowedTools:Array.isArray(frontmatter.disallowedTools) ? frontmatter.disallowedTools : undefined,
      skills:         Array.isArray(frontmatter.skills)          ? frontmatter.skills          : undefined,
      maxTurns:       (frontmatter.maxTurns    as number)   || undefined,
    };
  } catch {
    return null;
  }
}

export async function resolveAgent(
  agentName: string,
  projectPath: string,
): Promise<ResolvedAgent | null> {
  const home = await homeDir();

  // Resolution order:
  // 1. <project>/.claude/agents/<name>.md
  // 2. ~/.claude/agents/<name>.md
  // 3. Plugin cache ~/.claude/plugins/cache/**/<name>.md

  const candidates = [
    `${projectPath}/.claude/agents/${agentName}.md`,
    `${home}/.claude/agents/${agentName}.md`,
  ];

  for (const path of candidates) {
    const agent = await tryReadAgentMd(path);
    if (agent) return agent;
  }

  // Plugin cache scan (best-effort, non-fatal)
  try {
    const cacheDir = `${home}/.claude/plugins/cache`;
    const cacheExists = await exists(cacheDir);
    if (cacheExists) {
      // We can't readdir from Tauri fs plugin easily without listing,
      // so we fall back to well-known plugin paths for now.
      // A future improvement: use Tauri shell to glob.
      // For V1, project/.claude and user ~/.claude are sufficient.
    }
  } catch { /* non-fatal */ }

  return null;
}

export async function resolveAgents(
  agentNames: string[],
  projectPath: string,
): Promise<{ resolved: Record<string, ResolvedAgent>; missing: string[] }> {
  const resolved: Record<string, ResolvedAgent> = {};
  const missing: string[] = [];

  for (const name of agentNames) {
    const agent = await resolveAgent(name, projectPath);
    if (agent) {
      resolved[name] = agent;
    } else {
      missing.push(name);
    }
  }

  return { resolved, missing };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm nuxt typecheck 2>&1 | grep -E "agent-resolver|error TS" | head -20
```

- [ ] **Step 3: Commit**

```bash
git add app/services/agent-resolver.ts
git commit -m "feat(flow): add agent-resolver service to load AgentDefinitions from .claude/agents/"
```

---

## Task 5: `useFlowStore` — Pinia Store for Flow

**Files:**
- Create: `app/stores/flow.ts`
- Modify: `app/stores/pipelines.ts` (thin compatibility wrapper)

The Flow store replaces `usePipelinesStore` as the source of truth for board structure and agent config.

- [ ] **Step 1: Create `app/stores/flow.ts`**

```typescript
// app/stores/flow.ts
import type { Flow, FlowState, FlowWarning } from '~/types';
import { loadFlow, resolveConfigForState, type LoadFlowResult } from '~/services/flow-loader';
import { resolveAgents } from '~/services/agent-resolver';

export const useFlowStore = defineStore('flow', () => {
  const flow    = ref<Flow | null>(null);
  const flowMd  = ref<string>('');
  const warnings = ref<FlowWarning[]>([]);
  const loaded  = ref<string | null>(null); // projectPath that is currently loaded

  async function loadForProject(projectPath: string): Promise<void> {
    try {
      const result: LoadFlowResult = await loadFlow(projectPath);
      flow.value     = result.flow;
      flowMd.value   = result.flowMd;
      warnings.value = result.warnings;
      loaded.value   = projectPath;
      if (import.meta.dev) {
        console.log('[OnCraft] Flow loaded:', result.flow.name, result.flow.stateOrder.length, 'states');
        if (result.warnings.length) console.warn('[OnCraft] Flow warnings:', result.warnings);
      }
    } catch (err) {
      if (import.meta.dev) console.error('[OnCraft] Failed to load flow:', err);
      warnings.value = [{ scope: 'flow', message: `Failed to load flow: ${err}` }];
    }
  }

  function getFlowState(slug: string): FlowState | undefined {
    return flow.value?.states.find(s => s.slug === slug);
  }

  const stateOrder = computed(() => flow.value?.stateOrder ?? []);

  const flowWarnings = computed(() =>
    warnings.value.filter(w => w.scope === 'flow')
  );

  function stateWarnings(slug: string): FlowWarning[] {
    return warnings.value.filter(w => w.scope === 'state' && w.stateSlug === slug);
  }

  // Resolve full config for a card in a given state (Flow + FlowState layers)
  // Card-level overrides (model, effort, permissionMode) are applied by sessions.ts on top.
  // Note: named getResolvedConfig to avoid collision with imported resolveConfigForState from flow-loader.
  async function getResolvedConfig(
    stateSlug: string,
    projectPath: string,
  ): Promise<{
    agent: import('~/types').AgentConfig;
    agents: import('~/services/agent-resolver').ResolvedAgent[];
    agentsMissing: string[];
    skills: string[];
    mcpServers: Record<string, import('~/types').McpServerConfig>;
    allowedTools: string[];
    disallowedTools: string[];
    systemPromptAppend: string;
  } | null> {
    if (!flow.value) return null;

    const config = resolveConfigForState(flow.value, stateSlug, flowMd.value);

    // Resolve agent names → AgentDefinition objects
    const { resolved, missing } = await resolveAgents(config.agents, projectPath);

    // Add warnings for missing agents
    for (const name of missing) {
      const alreadyWarned = warnings.value.some(
        w => w.stateSlug === stateSlug && w.message.includes(name)
      );
      if (!alreadyWarned) {
        warnings.value.push({
          scope:     stateSlug ? 'state' : 'flow',
          stateSlug: stateSlug || undefined,
          message:   `Agent "${name}" not found in .claude/agents/ or plugins`,
        });
      }
    }

    return {
      ...config,
      agents: Object.values(resolved),
      agentsMissing: missing,
    };
  }

  // Get trigger prompt for a state (already loaded into FlowState.triggerPrompt)
  function getTriggerPrompt(slug: string): string | undefined {
    return getFlowState(slug)?.triggerPrompt;
  }

  // Check requiredFiles precondition for a card move
  function checkRequiredFiles(
    stateSlug: string,
    cardLinkedFiles: Record<string, string> | undefined,
  ): string[] {
    const state = getFlowState(stateSlug);
    if (!state?.requiredFiles?.length) return [];
    const files = cardLinkedFiles || {};
    return state.requiredFiles.filter(slot => !files[slot] || !files[slot].trim());
  }

  function reset(): void {
    flow.value     = null;
    flowMd.value   = '';
    warnings.value = [];
    loaded.value   = null;
  }

  return {
    flow, flowMd, warnings, loaded, stateOrder, flowWarnings,
    loadForProject, getFlowState, stateWarnings,
    getResolvedConfig, getTriggerPrompt, checkRequiredFiles, reset,
  };
});
```

- [ ] **Step 2: Make `usePipelinesStore` forward to `useFlowStore` for backward compatibility**

Components that still call `usePipelinesStore().getConfig()` (e.g. `ProjectSettings.vue`) will continue to work during the transition. Update `app/stores/pipelines.ts`:

```typescript
// app/stores/pipelines.ts — compatibility shim during transition
import type { ProjectConfig, ColumnConfig } from '~/types';

export const usePipelinesStore = defineStore('pipelines', () => {
  const flowStore = useFlowStore();

  function getConfig(projectPath: string): ProjectConfig | undefined {
    if (!flowStore.flow) return undefined;
    // Note: GitHub config is no longer part of Flow. It is stored separately in the project DB
    // or in a future .oncraft/project.yaml. Components that read github config (e.g. linked issues)
    // must be updated to read from the project store directly, not via pipelinesStore.getConfig().github.
    // For now, return undefined for github to avoid crashes (callers check optional chaining ?.github).
    return {
      columns: flowStore.flow.states.map(s => ({
        name:   s.name,
        color:  s.color,
        inputs:  [],
        outputs: [],
      })),
      // github: intentionally omitted — see migration note above
    };
  }

  // IMPORTANT: Any component reading getConfig().github?.repository for GitHub integration
  // (e.g. linked issues in KanbanCard) must be updated in Task 8 to read github config
  // from useProjectsStore() or a dedicated github config store instead.

  function getColumnConfig(projectPath: string, columnName: string): ColumnConfig | undefined {
    if (!flowStore.flow) return undefined;
    // Match by name (display name) or slug
    const state = flowStore.flow.states.find(
      s => s.name === columnName || s.slug === columnName
    );
    if (!state) return undefined;
    return { name: state.name, color: state.color };
  }

  // loadForProject now delegates to flowStore
  async function loadForProject(projectPath: string): Promise<ProjectConfig> {
    await flowStore.loadForProject(projectPath);
    return getConfig(projectPath) ?? { columns: [] };
  }

  // saveConfig is a no-op in the new model (flow.yaml is written directly)
  async function saveConfig(_projectPath: string, _config: ProjectConfig): Promise<void> {
    if (import.meta.dev) console.warn('[OnCraft] usePipelinesStore.saveConfig() is deprecated; edit .oncraft/flow.yaml directly');
  }

  return { getConfig, getColumnConfig, loadForProject, saveConfig };
});
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm nuxt typecheck 2>&1 | grep "error TS" | head -30
```

- [ ] **Step 4: Commit**

```bash
git add app/stores/flow.ts app/stores/pipelines.ts
git commit -m "feat(flow): add useFlowStore; make usePipelinesStore a compatibility shim"
```

---

## Task 6: Wire Flow Config into `sessions.ts` + Trigger Prompts

**Files:**
- Modify: `app/stores/sessions.ts`

Replace the old `columnPrompt` mechanism with the new Flow system. On session start, compose the full config from `useFlowStore`. On card move (triggered from `KanbanCard`), fire the trigger prompt.

- [ ] **Step 1: Update `send()` in `sessions.ts` to use `useFlowStore`**

Replace the existing `columnPrompt` block in `sessions.ts` (the block that calls `usePipelinesStore().getColumnConfig()`) with:

```typescript
// Resolve Flow config for the card's current state
const flowStore = useFlowStore();
const project = useProjectsStore().activeProject;
let flowConfig: Awaited<ReturnType<typeof flowStore.getResolvedConfig>> | null = null;

if (card && project && flowStore.flow) {
  flowConfig = await flowStore.getResolvedConfig(card.columnName, project.path);
}

// Card-level overrides on top of Flow defaults
if (flowConfig) {
  if (!config.model)          config.model          = flowConfig.agent.model;
  if (!config.effort)         config.effort         = flowConfig.agent.effort;
  if (!config.permissionMode) config.permissionMode = flowConfig.agent.permissionMode;
}

// Build the resolved session start payload
const flowPayload = flowConfig ? {
  systemPromptAppend: flowConfig.systemPromptAppend || undefined,
  allowedTools:   flowConfig.allowedTools.length   ? flowConfig.allowedTools   : undefined,
  disallowedTools: flowConfig.disallowedTools.length ? flowConfig.disallowedTools : undefined,
  agents: flowConfig.agents.length ? Object.fromEntries(
    flowConfig.agents.map(a => [a.name, {
      description:     a.description,
      prompt:          a.prompt,
      model:           a.model,
      tools:           a.tools,
      disallowedTools: a.disallowedTools,
      skills:          a.skills,
      maxTurns:        a.maxTurns,
    }])
  ) : undefined,
  mcpServers: Object.keys(flowConfig.mcpServers).length ? flowConfig.mcpServers : undefined,
} : {};
```

Then pass `flowPayload` to `spawnSession` / `sendStart`:

```typescript
// Pass flowPayload to process functions (signature changes in Task 7)
if (isProcessActive(cardId)) {
  await sendStart(cardId, project.path, message, sessionId, config, images, flowPayload);
} else {
  setupMessageListener(cardId);
  await spawnSession(cardId, project.path, message, sessionId, config, images, flowPayload);
}
```

- [ ] **Step 2: Add `fireTriggerPrompt()` function to sessions store**

```typescript
// Called by KanbanCard when a card moves to a new state
async function fireTriggerPrompt(cardId: string, toSlug: string): Promise<void> {
  const flowStore = useFlowStore();
  const raw = flowStore.getTriggerPrompt(toSlug);
  if (!raw) return;

  const cardsStore = useCardsStore();
  const card = cardsStore.cards.find(c => c.id === cardId);
  const project = useProjectsStore().activeProject;
  if (!card || !project) return;

  const prompt = resolveTemplate(raw, {
    session: {
      name: card.name,
      id:   card.sessionId || '',
      files: card.linkedFiles || {},
    },
    project: { path: project.path, name: project.name },
    card:    { description: card.description },
  });

  // Send as a new message (triggers a query)
  await send(cardId, prompt);
}
```

- [ ] **Step 3: Export `fireTriggerPrompt` from the store**

Add `fireTriggerPrompt` to the return statement of `useSessionsStore`.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
pnpm nuxt typecheck 2>&1 | grep "error TS" | head -30
```

- [ ] **Step 5: Commit**

```bash
git add app/stores/sessions.ts
git commit -m "feat(flow): wire Flow config into sessions; add fireTriggerPrompt on card move"
```

---

## Task 7: Extend Sidecar Protocol — New `start` Command Fields

**Files:**
- Modify: `app/services/claude-process.ts`
- Modify: `src-sidecar/agent-bridge.ts`

Add the new Flow fields to `spawnSession`/`sendStart` (frontend side) and `query()` (sidecar side).

- [ ] **Step 1: Update `claude-process.ts` — add `FlowPayload` type and pass fields**

Add above the `spawnSession` function:

```typescript
export interface FlowPayload {
  systemPromptAppend?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  agents?: Record<string, {
    description: string;
    prompt: string;
    model?: string;
    tools?: string[];
    disallowedTools?: string[];
    skills?: string[];
    maxTurns?: number;
  }>;
  mcpServers?: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}
```

Update `spawnSession` and `sendStart` signatures: **replace** the old `columnPrompt?: string` parameter with `flowPayload?: FlowPayload`. Remove `columnPrompt` entirely — it is superseded by `flowPayload.systemPromptAppend`. Also remove the `...(columnPrompt ? { columnPrompt } : {})` line from the `startCmd` JSON.

In `src-sidecar/agent-bridge.ts`, **remove** the existing `columnPrompt` handling (the block that sets `systemPrompt` from `cmd.columnPrompt`) before adding the new `systemPromptAppend` handling — otherwise both code paths would fight over the `systemPrompt` option.

Update the `startCmd` JSON to include the new fields:

```typescript
const startCmd = JSON.stringify({
  cmd: 'start',
  cardId,
  prompt,
  projectPath,
  ...(sessionId ? { sessionId } : {}),
  ...(config?.model          ? { model:          config.model          } : {}),
  ...(config?.effort         ? { effort:         config.effort         } : {}),
  ...(config?.permissionMode ? { permissionMode: config.permissionMode } : {}),
  ...(config?.worktreeName   ? { worktreeName:   config.worktreeName   } : {}),
  ...(imagePaths?.length     ? { imagePaths }                            : {}),
  // New Flow fields
  ...(flowPayload?.systemPromptAppend ? { systemPromptAppend: flowPayload.systemPromptAppend } : {}),
  ...(flowPayload?.allowedTools?.length    ? { allowedTools:    flowPayload.allowedTools    } : {}),
  ...(flowPayload?.disallowedTools?.length ? { disallowedTools: flowPayload.disallowedTools } : {}),
  ...(flowPayload?.agents && Object.keys(flowPayload.agents).length ? { agents: flowPayload.agents } : {}),
  ...(flowPayload?.mcpServers && Object.keys(flowPayload.mcpServers).length ? { mcpServers: flowPayload.mcpServers } : {}),
});
```

Apply same changes to `sendStart`.

- [ ] **Step 2: Update `src-sidecar/agent-bridge.ts` — pass new fields to `query()`**

Find the `const conversation = query({...})` block. Add after the existing options:

```typescript
// Flow-injected fields
...(cmd.systemPromptAppend ? {
  systemPrompt: {
    type: 'preset' as const,
    preset: 'claude_code' as const,
    append: cmd.systemPromptAppend as string,
  },
} : {}),
...(cmd.allowedTools    ? { allowedTools:    cmd.allowedTools    as string[] } : {}),
...(cmd.disallowedTools ? { disallowedTools: cmd.disallowedTools as string[] } : {}),
...(cmd.agents          ? { agents:          cmd.agents          as Record<string, any> } : {}),
...(cmd.mcpServers      ? { mcpServers:      cmd.mcpServers      as Record<string, any> } : {}),
```

- [ ] **Step 3: Build sidecar to verify TypeScript**

```bash
cd /Users/albert.puigsech/Develop/github.com/apuigsech/oncraft/.claude/worktrees/better-flows/src-sidecar
~/.bun/bin/bun build --compile --target=bun agent-bridge.ts --outfile /tmp/agent-bridge-test 2>&1 | tail -20
```

Expected: compiled successfully.

- [ ] **Step 4: Commit**

```bash
cd /Users/albert.puigsech/Develop/github.com/apuigsech/oncraft/.claude/worktrees/better-flows
git add app/services/claude-process.ts src-sidecar/agent-bridge.ts
git commit -m "feat(flow): extend sidecar start protocol with systemPrompt, tools, agents, MCPs"
```

---

## Task 8: Update Board Components to Use `useFlowStore`

**Files:**
- Modify: `app/components/KanbanBoard.vue`
- Modify: `app/components/KanbanColumn.vue`
- Modify: `app/components/KanbanCard.vue`

Board and columns now source their structure from `useFlowStore` instead of `usePipelinesStore`.

- [ ] **Step 1: Update `KanbanBoard.vue`**

Replace any reference to `usePipelinesStore().getConfig().columns` with `useFlowStore().stateOrder` and map to states.

The board renders one `KanbanColumn` per entry in `stateOrder`. Each column's `name`/`color` comes from `useFlowStore().getFlowState(slug)`:

```typescript
// In KanbanBoard.vue <script setup>
const flowStore = useFlowStore();
const columns = computed(() =>
  flowStore.stateOrder.map(slug => flowStore.getFlowState(slug)).filter(Boolean)
);
```

Replace the `v-for` over `config.columns` with `v-for` over `columns`. Use `:key="state.slug"` (the stable identifier, not `state.name` which can change):

```html
<KanbanColumn
  v-for="state in columns"
  :key="state.slug"
  :flowState="state"
/>
```

- [ ] **Step 2: Update `KanbanColumn.vue` — switch prop from `ColumnConfig` to `FlowState`; show warnings badge**

`KanbanColumn` currently receives `:column="col"` (a `ColumnConfig`) from `KanbanBoard`. Change it to receive the full `FlowState`:

```typescript
// Old prop (remove):
// const props = defineProps<{ column: ColumnConfig }>();

// New prop:
const props = defineProps<{
  flowState: import('~/types').FlowState;
}>();
const flowStore = useFlowStore();
const warnings  = computed(() => flowStore.stateWarnings(props.flowState.slug));
```

Update **all** internal references throughout `KanbanColumn.vue`:
- `props.column.name` → `props.flowState.name`
- `props.column.color` → `props.flowState.color`
- `cardsStore.cardsByColumn(props.column.name)` → `cardsStore.cardsByColumn(props.flowState.slug)`
  - `cardsByColumn` matches on `card.columnName` which now stores the slug, so pass the slug
- `data-column-name` attribute in the draggable → use `props.flowState.slug` (stable identifier)
- `moveCard(cardId, props.column.name, ...)` → `moveCard(cardId, props.flowState.slug, ...)`

Add a warning indicator next to the column name in the template:

```html
<span v-if="warnings.length" class="state-warning" title="Flow configuration issues">⚠️</span>
```

Update `KanbanBoard.vue` to pass `:flowState="state"` instead of `:column="col"`:
```html
<KanbanColumn
  v-for="state in columns"
  :key="state.slug"
  :flowState="state"
/>
```

- [ ] **Step 3: Update `KanbanColumn.vue` `onDragEnd` — `requiredFiles` gate + trigger prompt**

Drag-and-drop is handled in `KanbanColumn.vue`'s `onDragEnd` function (not in `KanbanCard.vue`). Find the existing `onDragEnd` callback and add the `requiredFiles` check and trigger prompt firing:

```typescript
// In KanbanColumn.vue — inside onDragEnd, after computing toSlug and newOrder
// but BEFORE calling cardsStore.moveCard():
const flowStore   = useFlowStore();
const sessionsStore = useSessionsStore();
const movingCard  = cardsStore.cards.find(c => c.id === movedCardId);

const missing = flowStore.checkRequiredFiles(toSlug, movingCard?.linkedFiles);
if (missing.length > 0) {
  // Abort drag: revert DOM, show dialog listing missing slots
  evt.from.appendChild(evt.item); // revert drag DOM
  missingFiles.value     = missing;
  showRequiredFilesDialog.value = true;
  return;
}

await cardsStore.moveCard(movedCardId, toSlug, newOrder);
// Fire trigger prompt if the target state has trigger.md
await sessionsStore.fireTriggerPrompt(movedCardId, toSlug);
```

Add reactive state for the dialog:
```typescript
const missingFiles            = ref<string[]>([]);
const showRequiredFilesDialog = ref(false);
```

Add a simple dialog/toast in the template:
```html
<div v-if="showRequiredFilesDialog" class="required-files-dialog">
  <p>Cannot move card — missing required files:</p>
  <ul><li v-for="f in missingFiles" :key="f">{{ f }}</li></ul>
  <button @click="showRequiredFilesDialog = false">Close</button>
</div>
```

For orphaned cards (slug not in `stateOrder`), `KanbanBoard.vue` computes them and renders a ghost column:

```typescript
// In KanbanBoard.vue
const orphanedCards = computed(() =>
  cardsStore.cards.filter(
    c => !c.archived && !flowStore.stateOrder.includes(c.columnName)
  )
);
```

```html
<!-- In KanbanBoard.vue template, after the normal columns v-for -->
<div v-if="orphanedCards.length" class="column-unknown">
  <h3>⚠️ Unknown Column</h3>
  <p>These cards reference a column that no longer exists. Move them to a valid column.</p>
  <KanbanCard v-for="card in orphanedCards" :key="card.id" :card="card" />
</div>
```

- [ ] **Step 4: Fix GitHub config reading in components**

Components (e.g. `KanbanCard.vue`) that currently read `pipelinesStore.getConfig(path)?.github?.repository` for GitHub issue linking must be updated. The compatibility shim no longer returns `github`.

Find all such usages:
```bash
grep -rn "github\|\.github" app/components/ app/stores/ --include="*.vue" --include="*.ts" | grep -v node_modules
```

For each one: replace `pipelinesStore.getConfig(path)?.github?.repository` with reading directly from the project object in `useProjectsStore().activeProject` — but note that the `Project` type does not currently store github config. For V1, read it from `usePipelinesStore().getConfig(path)?.github` which will be `undefined` (acceptable — GitHub integration degrades gracefully until a proper `project.yaml` is implemented).

Document this as a known V1 limitation in a code comment.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
pnpm nuxt typecheck 2>&1 | grep "error TS" | head -30
```

- [ ] **Step 6: Commit**

```bash
git add app/components/KanbanBoard.vue app/components/KanbanColumn.vue app/components/KanbanCard.vue
git commit -m "feat(flow): update board components to use useFlowStore; add warnings badge; requiredFiles gate"
```

---

## Task 9: Hook Flow Loading into Project Open

**Files:**
- Modify: wherever `usePipelinesStore().loadForProject()` is currently called (likely `KanbanBoard.vue` or a project composable)

Ensure `useFlowStore().loadForProject()` is called when a project opens.

- [ ] **Step 1: Audit all `usePipelinesStore` call sites**

Known call sites beyond those already updated in Tasks 5–8:

```bash
grep -rn "usePipelinesStore\|pipelinesStore" app/ --include="*.vue" --include="*.ts" | grep -v node_modules
```

Expected locations (from codebase analysis):
- `app/app.vue` — calls `pipelinesStore.loadForProject()` on project open
- `app/components/TabBar.vue` — calls `pipelinesStore.loadForProject()` or reads `getConfig()`
- `app/services/claude-process.ts` — `handleSessionRequest` reads `pipelinesStore.getConfig()` for the MCP `get_project` action (returns columns to the agent)

For `app/app.vue` and `app/components/TabBar.vue`: since the compatibility shim delegates `loadForProject` to `useFlowStore`, calling `usePipelinesStore().loadForProject()` will correctly trigger `useFlowStore` loading. No change needed unless they bypass the shim.

For `app/services/claude-process.ts` `handleSessionRequest` (the `get_project` action): update to use `useFlowStore` directly:

```typescript
// OLD:
const pipelinesStore = usePipelinesStore();
const config = projectPath ? pipelinesStore.getConfig(projectPath) : undefined;
const columns = (config?.columns ?? []).map(c => ({ name: c.name, color: c.color, ... }));

// NEW:
const flowStore = useFlowStore();
const columns = flowStore.stateOrder.map(slug => {
  const s = flowStore.getFlowState(slug);
  return s ? { name: s.name, color: s.color, slug: s.slug, hasPrompt: !!s.prompt } : null;
}).filter(Boolean);
```

- [ ] **Step 2: Verify all `usePipelinesStore` call sites are handled**

- [ ] **Step 3: Add Flow warnings to project tab badge**

Find the component that renders the project tab/header. Add a visual indicator if `flowStore.flowWarnings.length > 0`. A simple approach: pass warnings count as a prop or use the store directly:

```html
<span v-if="flowStore.flowWarnings.length" class="project-warning-badge" title="Flow configuration issues">
  ⚠️ {{ flowStore.flowWarnings.length }}
</span>
```

- [ ] **Step 4: Verify TypeScript compiles and app starts**

```bash
pnpm nuxt typecheck 2>&1 | grep "error TS" | head -20
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(flow): hook useFlowStore into project open; show flow warnings in project tab"
```

---

## Task 10: Build Sidecar and Smoke Test

- [ ] **Step 1: Build the sidecar binary**

```bash
cd /Users/albert.puigsech/Develop/github.com/apuigsech/oncraft/.claude/worktrees/better-flows
pnpm build:sidecar 2>&1 | tail -20
```

Expected: compiled successfully, binary at `src-tauri/binaries/agent-bridge-*`.

- [ ] **Step 2: Run the Tauri app in dev mode**

```bash
pnpm tauri dev
```

Expected: app launches, board renders with columns from `.oncraft/flow.yaml` (or defaults if no config).

- [ ] **Step 3: Smoke test — existing project with `config.yaml`**

Open a project that has `.oncraft/config.yaml` (no `flow.yaml`). Verify:
- Migration runs: `.oncraft/flow.yaml` and `states/*/state.yaml` are created
- `config.yaml.bak` exists
- Board shows the same columns as before

- [ ] **Step 4: Smoke test — new Flow features**

Create a test project with `.oncraft/flow.yaml` containing:
```yaml
name: "Test Flow"
stateOrder: [backlog, doing, done]
agent:
  model: sonnet
```
And `states/doing/state.yaml`:
```yaml
name: Doing
color: "#fbbf24"
```

Open the project. Verify:
- Board shows 3 columns: Backlog, Doing, Done
- Starting a session in "Doing" — check sidecar stderr for `systemPrompt` being passed

- [ ] **Step 5: Commit smoke test results**

```bash
git add -A
git commit -m "feat(flow): complete Flow system implementation — sidecar build + smoke test pass"
```

---

## Task 11: Create Built-in Default Preset

**Files:**
- Create: `~/.oncraft/presets/swe-basic/flow.yaml` and `states/`

This is data, not code. Create the default preset so new projects can use it.

- [ ] **Step 1: Create the `swe-basic` preset directory structure**

```bash
mkdir -p ~/.oncraft/presets/swe-basic/states/{brainstorm,specify,plan,implement,review,done}
```

- [ ] **Step 2: Write `~/.oncraft/presets/swe-basic/flow.yaml`**

```yaml
name: "SWE Basic"
agent:
  model: sonnet
  effort: high
  permissionMode: default
stateOrder:
  - brainstorm
  - specify
  - plan
  - implement
  - review
  - done
```

- [ ] **Step 3: Write `state.yaml` for each state**

```bash
# brainstorm
cat > ~/.oncraft/presets/swe-basic/states/brainstorm/state.yaml << 'EOF'
name: Brainstorm
color: "#a78bfa"
EOF

# specify
cat > ~/.oncraft/presets/swe-basic/states/specify/state.yaml << 'EOF'
name: Specify
color: "#60a5fa"
EOF

# plan
cat > ~/.oncraft/presets/swe-basic/states/plan/state.yaml << 'EOF'
name: Plan
color: "#34d399"
EOF

# implement
cat > ~/.oncraft/presets/swe-basic/states/implement/state.yaml << 'EOF'
name: Implement
color: "#fbbf24"
EOF

# review
cat > ~/.oncraft/presets/swe-basic/states/review/state.yaml << 'EOF'
name: Review
color: "#f472b6"
requiredFiles:
  - spec
  - plan
EOF

# done
cat > ~/.oncraft/presets/swe-basic/states/done/state.yaml << 'EOF'
name: Done
color: "#22c55e"
EOF
```

- [ ] **Step 4: Write `flow.md` (global system prompt)**

```bash
cat > ~/.oncraft/presets/swe-basic/flow.md << 'EOF'
You are working within OnCraft, a Kanban-driven development workflow. Each card represents a task or feature moving through the development lifecycle. Follow the workflow for the current state as described in your instructions.
EOF
```

- [ ] **Step 5: Write `implement/trigger.md`**

```bash
cat > ~/.oncraft/presets/swe-basic/states/implement/trigger.md << 'EOF'
The card "{{ session.name }}" has moved to the Implementation phase.

{{ card.description }}

Work through the implementation systematically. If a plan exists at {{ session.files.plan }}, follow it. Commit progress frequently.
EOF
```

- [ ] **Step 6: Smoke test the preset**

In OnCraft, create a new project and edit its `.oncraft/flow.yaml` to add `preset: swe-basic`. Reload the project. Verify the board shows the 6 default columns.

---

## Task 12: `ProjectSettings.vue` — Replace Pipeline Editor with Flow Info

**Files:**
- Modify: `app/components/ProjectSettings.vue`

The old `PipelineEditor` and `ColumnEditor` are superseded. Project settings now shows Flow info and a button to open `.oncraft/` in the editor.

- [ ] **Step 1: Update `ProjectSettings.vue`**

Replace the `ColumnEditor` and `PipelineEditor` components with a simple Flow summary:

```html
<div class="settings-section">
  <h4>Flow</h4>
  <div class="field">
    <span class="field-label">Name</span>
    <span class="field-value">{{ flowStore.flow?.name ?? 'Loading...' }}</span>
  </div>
  <div class="field">
    <span class="field-label">States</span>
    <span class="field-value">{{ flowStore.stateOrder.join(' → ') }}</span>
  </div>
  <div v-if="flowStore.flow?.preset" class="field">
    <span class="field-label">Preset</span>
    <span class="field-value mono">{{ flowStore.flow.preset }}</span>
  </div>
  <div v-if="flowStore.flowWarnings.length" class="warnings-section">
    <span class="field-label">Warnings</span>
    <ul class="warning-list">
      <li v-for="w in flowStore.flowWarnings" :key="w.message">{{ w.message }}</li>
    </ul>
  </div>
  <button class="btn-secondary" @click="openFlowConfig">
    Edit Flow Config (.oncraft/)
  </button>
</div>
```

```typescript
import { open as openPath } from '@tauri-apps/plugin-opener';

const flowStore = useFlowStore();

async function openFlowConfig() {
  const project = useProjectsStore().activeProject;
  if (!project) return;
  // Open .oncraft/ in the system file manager using Tauri opener plugin
  // (invoke('open_path') does not exist — use the opener plugin instead)
  await openPath(`${project.path}/.oncraft`);
}
```

- [ ] **Step 2: Remove `ColumnEditor` import/usage**

Remove the `<ColumnEditor>` block from `ProjectSettings.vue` — it is superseded by the Flow summary.
Note: `ProjectSettings.vue` uses `<ColumnEditor>`, not `<PipelineEditor>` — the PipelineEditor was already removed in a previous commit.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm nuxt typecheck 2>&1 | grep "error TS" | head -20
```

- [ ] **Step 4: Commit**

```bash
git add app/components/ProjectSettings.vue
git commit -m "feat(flow): update ProjectSettings to show Flow summary; remove deprecated ColumnEditor"
```

---

## Task 13: Final Cleanup and Integration Commit

- [ ] **Step 1: Run full typecheck**

```bash
pnpm nuxt typecheck 2>&1 | grep "error TS"
```

Expected: 0 errors.

- [ ] **Step 2: Build the sidecar**

```bash
pnpm build:sidecar 2>&1 | tail -5
```

Expected: `✓ Compiled ...` with no errors.

- [ ] **Step 3: Run the app and verify end-to-end**

```bash
pnpm tauri dev
```

Verify:
1. Board renders from `useFlowStore` (columns match `flow.yaml` or defaults)
2. Project with `config.yaml` auto-migrates to `flow.yaml` on first load
3. Starting a session in a state with a `prompt.md` — sidecar receives `systemPromptAppend`
4. Moving a card to a state with `trigger.md` fires the trigger prompt automatically
5. Moving a card to a state with `requiredFiles` and missing linked files shows the block dialog
6. Flow/state warnings appear in the correct UI locations

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(flow): complete Flow system — board-aware agent config, trigger prompts, requiredFiles"
```

---

## Appendix: Key Invariants

| Invariant | Where enforced |
|-----------|----------------|
| `Card.columnName` = `FlowState.slug` (not display name) | `flow-loader.ts` migration renames slugs; `KanbanCard` passes slug on move |
| `disallowed` wins over `allowed` in tool merge | `resolveConfigForState()` in `flow-loader.ts` |
| Trigger fires only on user-initiated moves | `KanbanColumn.onDragEnd()` — no auto-move in V1 |
| Missing agents/MCPs = warning, not error | `useFlowStore.getResolvedConfig()` |
| `requiredFiles` = only hard block | `useFlowStore.checkRequiredFiles()` called before `moveCard` |
| Preset merge: additive for resources, replacement for `stateOrder`/`flow.md`/`*.md` | `flow-loader.ts` `mergeWithPreset()` |
