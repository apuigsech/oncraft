# SWE Basic Preset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the preset system and populate the "swe-basic" default preset with all state prompts, triggers, and artifacts.

**Architecture:** A preset loader service reads the directory structure at `~/.oncraft/presets/<name>/` (flow.yaml, flow.md, per-state state.yaml/state.md/trigger.md). The pipelines store uses presets instead of hardcoded defaults. The template engine is extended for nested property access and whitespace tolerance. The sidecar accepts system prompts. The KanbanColumn drag handler uses preset triggers and validates requiredFiles.

**Tech Stack:** TypeScript, Vue 3, Nuxt 4, Tauri (fs plugin), Bun (sidecar), js-yaml, Claude Agent SDK

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `app/types/index.ts` | Modify | Add `FlowPreset`, `FlowState`, extend `ColumnConfig` with `icon`, extend `TemplateContext` with `linkedFiles` |
| `app/services/preset-loader.ts` | Create | Read preset directory from `~/.oncraft/presets/<name>/`, parse YAML/MD files, return `FlowPreset` |
| `app/services/template-engine.ts` | Modify | Support whitespace in `{{ }}`, support nested property access (3+ levels) |
| `app/services/config-loader.ts` | Modify | Use preset loader for defaults instead of hardcoded constants |
| `app/stores/pipelines.ts` | Modify | Load preset, expose state configs and triggers, replace hardcoded defaults |
| `app/services/claude-process.ts` | Modify | Accept and pass `systemPrompt` field in start command |
| `src-sidecar/agent-bridge.ts` | Modify | Pass `systemPrompt` to SDK `query()` options |
| `app/components/KanbanColumn.vue` | Modify | Use preset triggers instead of pipeline prompts, add requiredFiles validation, pass `linkedFiles` to template context |
| `app/components/KanbanBoard.vue` | No change | Already reads columns from pipelines store |
| `~/.oncraft/presets/swe-basic/` | Create/Update | Populate all state.yaml, state.md, trigger.md files per spec |

---

### Task 1: Add Preset Types to `app/types/index.ts`

**Files:**
- Modify: `app/types/index.ts:34-37` (ColumnConfig), `app/types/index.ts:111-116` (TemplateContext)

- [ ] **Step 1: Add `FlowState` interface**

```typescript
export interface FlowState {
  name: string;
  color: string;
  icon?: string;
  artifact?: string;
  requiredFiles?: string[];
  systemPrompt?: string;   // content of state.md
  trigger?: string;         // content of trigger.md
}
```

Add after `PipelineConfig` (line 43).

- [ ] **Step 2: Add `FlowPreset` interface**

```typescript
export interface FlowPreset {
  name: string;
  agent: {
    model: ModelAlias;
    effort: EffortLevel;
    permissionMode: PermissionMode;
  };
  systemPrompt?: string;    // content of flow.md
  states: FlowState[];
}
```

Add after `FlowState`.

- [ ] **Step 3: Extend `ColumnConfig` with optional `icon`**

```typescript
export interface ColumnConfig {
  name: string;
  color: string;
  icon?: string;
}
```

- [ ] **Step 4: Extend `TemplateContext` to include `linkedFiles`**

```typescript
export interface TemplateContext {
  session: { name: string; id: string };
  project: { path: string; name: string };
  card: { description: string; linkedFiles?: Record<string, string> };
  column: { from: string; to: string };
}
```

- [ ] **Step 5: Commit**

```bash
git add app/types/index.ts
git commit -m "feat(types): add FlowPreset, FlowState types and extend ColumnConfig/TemplateContext"
```

---

### Task 2: Extend Template Engine

**Files:**
- Modify: `app/services/template-engine.ts:1-13`

- [ ] **Step 1: Update `resolveTemplate` to support whitespace and nested paths**

Replace the entire function body:

```typescript
import type { TemplateContext } from '~/types';

export function resolveTemplate(
  template: string, context: TemplateContext
): string {
  return template.replace(/\{\{\s*([\w]+(?:\.[\w]+)+)\s*\}\}/g, (_match, path: string) => {
    const parts = path.split('.');
    let current: unknown = context;
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return _match;
      }
    }
    return typeof current === 'string' || typeof current === 'number' ? String(current) : _match;
  });
}
```

This handles:
- `{{ session.name }}` (with spaces) — whitespace tolerance via `\s*`
- `{{ card.linkedFiles.spec }}` (3 levels) — dynamic property path walking
- `{{session.name}}` (no spaces) — still works

- [ ] **Step 2: Commit**

```bash
git add app/services/template-engine.ts
git commit -m "feat(template): support whitespace in delimiters and nested property access"
```

---

### Task 3: Create Preset Loader Service

**Files:**
- Create: `app/services/preset-loader.ts`

- [ ] **Step 1: Create the preset loader**

```typescript
import { readTextFile, exists, readDir } from '@tauri-apps/plugin-fs';
import { homeDir, join } from '@tauri-apps/api/path';
import * as yaml from 'js-yaml';
import type { FlowPreset, FlowState, ModelAlias, EffortLevel, PermissionMode } from '~/types';

const PRESETS_DIR = '.oncraft/presets';

export async function loadPreset(presetName: string): Promise<FlowPreset> {
  const home = await homeDir();
  const presetDir = await join(home, PRESETS_DIR, presetName);

  // Read flow.yaml
  const flowYamlPath = await join(presetDir, 'flow.yaml');
  const flowYamlContent = await readTextFile(flowYamlPath);
  const flowYaml = yaml.load(flowYamlContent) as {
    name: string;
    agent: { model: string; effort: string; permissionMode: string };
    stateOrder: string[];
  };

  // Read flow.md (optional)
  const flowMdPath = await join(presetDir, 'flow.md');
  let systemPrompt: string | undefined;
  if (await exists(flowMdPath)) {
    systemPrompt = await readTextFile(flowMdPath);
  }

  // Read each state
  const states: FlowState[] = [];
  for (const stateName of flowYaml.stateOrder) {
    const stateDir = await join(presetDir, 'states', stateName);
    const stateYamlPath = await join(stateDir, 'state.yaml');

    if (!(await exists(stateYamlPath))) {
      // State directory missing — create minimal state
      states.push({ name: stateName, color: '#888888' });
      continue;
    }

    const stateYamlContent = await readTextFile(stateYamlPath);
    const stateYaml = yaml.load(stateYamlContent) as Record<string, unknown>;

    const state: FlowState = {
      name: stateYaml.name as string || stateName,
      color: stateYaml.color as string || '#888888',
      icon: stateYaml.icon as string | undefined,
      artifact: stateYaml.artifact as string | undefined,
      requiredFiles: stateYaml.requiredFiles as string[] | undefined,
    };

    // Read state.md (optional)
    const stateMdPath = await join(stateDir, 'state.md');
    if (await exists(stateMdPath)) {
      state.systemPrompt = await readTextFile(stateMdPath);
    }

    // Read trigger.md (optional)
    const triggerMdPath = await join(stateDir, 'trigger.md');
    if (await exists(triggerMdPath)) {
      state.trigger = await readTextFile(triggerMdPath);
    }

    states.push(state);
  }

  return {
    name: flowYaml.name,
    agent: {
      model: flowYaml.agent.model as ModelAlias,
      effort: flowYaml.agent.effort as EffortLevel,
      permissionMode: flowYaml.agent.permissionMode as PermissionMode,
    },
    systemPrompt,
    states,
  };
}

export async function getDefaultPresetName(): Promise<string> {
  return 'swe-basic';
}
```

- [ ] **Step 2: Commit**

```bash
git add app/services/preset-loader.ts
git commit -m "feat(services): add preset-loader to read flow presets from ~/.oncraft/presets/"
```

---

### Task 4: Integrate Preset into Pipelines Store

**Files:**
- Modify: `app/stores/pipelines.ts:1-48`

- [ ] **Step 1: Extend the store to load and expose preset data**

Replace the entire file:

```typescript
import type { ProjectConfig, FlowPreset, FlowState } from '~/types';
import { loadProjectConfig, saveProjectConfig } from '~/services/config-loader';
import { loadPreset, getDefaultPresetName } from '~/services/preset-loader';

export const usePipelinesStore = defineStore('pipelines', () => {
  const configs: Record<string, ProjectConfig> = reactive({});
  const presets: Record<string, FlowPreset> = reactive({});
  const activePresetName = ref<string>('');

  async function loadDefaultPreset(): Promise<FlowPreset> {
    const name = await getDefaultPresetName();
    if (!presets[name]) {
      presets[name] = await loadPreset(name);
    }
    activePresetName.value = name;
    return presets[name];
  }

  async function loadForProject(projectPath: string): Promise<ProjectConfig> {
    // Ensure default preset is loaded
    const preset = await loadDefaultPreset();

    try {
      const config = await loadProjectConfig(projectPath);
      configs[projectPath] = config;
      if (import.meta.dev) console.log('[OnCraft] config loaded for', projectPath, ':', config.columns.length, 'columns');
      return config;
    } catch (err) {
      if (import.meta.dev) console.warn('[OnCraft] Failed to load project config, using preset defaults:', err);
      // Generate config from preset
      const config: ProjectConfig = {
        columns: preset.states.map(s => ({ name: s.name, color: s.color, icon: s.icon })),
        pipelines: [],
      };
      configs[projectPath] = config;
      return config;
    }
  }

  function getConfig(projectPath: string): ProjectConfig | undefined {
    return configs[projectPath];
  }

  function getActivePreset(): FlowPreset | undefined {
    return presets[activePresetName.value];
  }

  function getState(stateName: string): FlowState | undefined {
    const preset = getActivePreset();
    return preset?.states.find(s => s.name === stateName);
  }

  function findTrigger(toColumn: string): string | undefined {
    return getState(toColumn)?.trigger;
  }

  function getSystemPrompt(stateName: string): string | undefined {
    const preset = getActivePreset();
    if (!preset) return undefined;
    const parts: string[] = [];
    if (preset.systemPrompt) parts.push(preset.systemPrompt);
    const state = preset.states.find(s => s.name === stateName);
    if (state?.systemPrompt) parts.push(state.systemPrompt);
    return parts.length > 0 ? parts.join('\n\n') : undefined;
  }

  // Legacy support
  function findPipeline(projectPath: string, from: string, to: string) {
    const config = configs[projectPath];
    if (!config) return undefined;
    return config.pipelines.find(p => p.from === from && p.to === to);
  }

  async function saveConfig(projectPath: string, config: ProjectConfig): Promise<void> {
    configs[projectPath] = config;
    await saveProjectConfig(projectPath, config);
  }

  return {
    configs, presets, activePresetName,
    loadForProject, loadDefaultPreset, getConfig, getActivePreset, getState,
    findTrigger, findPipeline, getSystemPrompt, saveConfig,
  };
});
```

- [ ] **Step 2: Commit**

```bash
git add app/stores/pipelines.ts
git commit -m "feat(store): integrate preset loader into pipelines store"
```

---

### Task 5: Add System Prompt Support to Sidecar

**Files:**
- Modify: `src-sidecar/agent-bridge.ts` (start command handler, ~line 316)
- Modify: `app/services/claude-process.ts:209-256` (spawnSession and sendStart)

- [ ] **Step 1: Update sidecar to accept and pass `systemPrompt`**

In `src-sidecar/agent-bridge.ts`, in the `cmd === "start"` handler, add `systemPrompt` to the `query()` options. Find the `const conversation = query({` block (~line 316) and add:

```typescript
systemPrompt: (cmd.systemPrompt as string) || undefined,
```

Add it inside the `options` object, after the `permissionMode` line.

- [ ] **Step 2: Update `spawnSession` in `claude-process.ts` to accept `systemPrompt`**

In `app/services/claude-process.ts`, modify the `spawnSession` function signature (~line 183) to accept an optional `systemPrompt` parameter, and include it in the start command JSON (~line 209):

```typescript
...(systemPrompt ? { systemPrompt } : {}),
```

Add after the `imagePaths` line in the JSON object.

- [ ] **Step 3: Update `sendStart` in `claude-process.ts` to accept `systemPrompt`**

Same change for `sendStart` (~line 226): add `systemPrompt?: string` parameter and include it in the JSON.

- [ ] **Step 4: Commit**

```bash
git add src-sidecar/agent-bridge.ts app/services/claude-process.ts
git commit -m "feat(sidecar): support systemPrompt field in start command"
```

---

### Task 6: Update Sessions Store to Pass System Prompt

**Files:**
- Modify: `app/stores/sessions.ts:220-260` (send function)

- [ ] **Step 1: Compose and pass system prompt when sending messages**

In the `send` function, after getting the session config (~line 231), compose the system prompt from the preset:

```typescript
const pipelinesStore = usePipelinesStore();
const systemPrompt = card ? pipelinesStore.getSystemPrompt(card.columnName) : undefined;
```

Then pass `systemPrompt` as an additional argument to both `sendStart()` and `spawnSession()` calls.

- [ ] **Step 2: Commit**

```bash
git add app/stores/sessions.ts
git commit -m "feat(sessions): compose and pass preset system prompt on send"
```

---

### Task 7: Update KanbanColumn for Preset Triggers and requiredFiles Validation

**Files:**
- Modify: `app/components/KanbanColumn.vue:30-68` (onDragEnd function)

- [ ] **Step 1: Replace pipeline trigger with preset trigger in `onDragEnd`**

Replace the pipeline trigger block (lines 46-59) with preset-based trigger logic:

```typescript
// Preset trigger (replaces legacy pipeline)
const project = projectsStore.activeProject;
if (project) {
  const state = pipelinesStore.getState(toColumnName);

  // requiredFiles validation
  if (state?.requiredFiles?.length) {
    const linkedFiles = card.linkedFiles || {};
    const missing = state.requiredFiles.filter(key => !linkedFiles[key]);
    if (missing.length > 0) {
      // Block transition — revert card position
      await cardsStore.moveCard(card.id, fromColumnName, evt.oldIndex ?? 0);
      alert(`Cannot move to ${toColumnName}: missing linked files: ${missing.join(', ')}`);
      return;
    }
  }

  await cardsStore.moveCard(card.id, toColumnName, newIndex);

  // Send trigger prompt if defined
  const trigger = pipelinesStore.findTrigger(toColumnName);
  if (trigger) {
    const prompt = resolveTemplate(trigger, {
      session: { name: card.name, id: card.sessionId },
      project: { path: project.path, name: project.name },
      card: { description: card.description, linkedFiles: card.linkedFiles || {} },
      column: { from: fromColumnName, to: toColumnName },
    });
    sessionsStore.send(card.id, prompt);
    sessionsStore.openChat(card.id);
  } else {
    // Legacy pipeline fallback
    const pipeline = pipelinesStore.findPipeline(project.path, fromColumnName, toColumnName);
    if (pipeline) {
      const prompt = resolveTemplate(pipeline.prompt, {
        session: { name: card.name, id: card.sessionId },
        project: { path: project.path, name: project.name },
        card: { description: card.description, linkedFiles: card.linkedFiles || {} },
        column: { from: fromColumnName, to: toColumnName },
      });
      sessionsStore.send(card.id, prompt);
      sessionsStore.openChat(card.id);
    }
  }
}
```

Note: the `moveCard` call moves from line 44 into the block after validation.

- [ ] **Step 2: Commit**

```bash
git add app/components/KanbanColumn.vue
git commit -m "feat(kanban): use preset triggers with requiredFiles validation"
```

---

### Task 8: Add Icon Support to Kanban Column Header

**Files:**
- Modify: `app/components/KanbanColumn.vue:82-101` (template, column header)

- [ ] **Step 1: Render icon in column header**

Replace the `color-dot` span (line 87) with a conditional icon or dot:

```html
<UIcon v-if="column.icon" :name="column.icon" class="column-icon" />
<span v-else class="color-dot" :style="{ background: column.color }" />
```

- [ ] **Step 2: Add CSS for the icon**

Add to the `<style scoped>` section:

```css
.column-icon { font-size: 16px; flex-shrink: 0; }
```

Style the icon color to match the column color by adding `:style="{ color: column.color }"` to the UIcon.

- [ ] **Step 3: Commit**

```bash
git add app/components/KanbanColumn.vue
git commit -m "feat(kanban): render column icon from preset state config"
```

---

### Task 9: Populate the swe-basic Preset Files

**Files:**
- Update: `~/.oncraft/presets/swe-basic/flow.yaml`
- Update: `~/.oncraft/presets/swe-basic/flow.md`
- Update: `~/.oncraft/presets/swe-basic/states/Brainstorm/state.yaml`
- Create: `~/.oncraft/presets/swe-basic/states/Brainstorm/state.md`
- Update: `~/.oncraft/presets/swe-basic/states/Specify/state.yaml`
- Create: `~/.oncraft/presets/swe-basic/states/Specify/state.md`
- Create: `~/.oncraft/presets/swe-basic/states/Specify/trigger.md`
- Update: `~/.oncraft/presets/swe-basic/states/Plan/state.yaml`
- Create: `~/.oncraft/presets/swe-basic/states/Plan/state.md`
- Create: `~/.oncraft/presets/swe-basic/states/Plan/trigger.md`
- Update: `~/.oncraft/presets/swe-basic/states/Implement/state.yaml`
- Create: `~/.oncraft/presets/swe-basic/states/Implement/state.md`
- Update: `~/.oncraft/presets/swe-basic/states/Implement/trigger.md`
- Update: `~/.oncraft/presets/swe-basic/states/Review/state.yaml`
- Create: `~/.oncraft/presets/swe-basic/states/Review/state.md`
- Create: `~/.oncraft/presets/swe-basic/states/Review/trigger.md`
- Update: `~/.oncraft/presets/swe-basic/states/Done/state.yaml`
- Create: `~/.oncraft/presets/swe-basic/states/Done/state.md`
- Create: `~/.oncraft/presets/swe-basic/states/Done/trigger.md`

All file contents are defined in the spec at `docs/superpowers/specs/2026-03-21-swe-basic-preset-design.md`. Write each file exactly as specified in the "State Definitions" section.

- [ ] **Step 1: Update `flow.md`** with the global system prompt from the spec

- [ ] **Step 2: Update all `state.yaml` files** — add `icon`, `artifact`, and `requiredFiles` fields per spec

- [ ] **Step 3: Create all `state.md` files** — one per state with the system prompt content from the spec

- [ ] **Step 4: Create/update all `trigger.md` files** — for Specify, Plan, Implement, Review, Done with template content from the spec

- [ ] **Step 5: Verify file structure matches spec**

```bash
find ~/.oncraft/presets/swe-basic/ -type f | sort
```

Expected output:
```
~/.oncraft/presets/swe-basic/flow.md
~/.oncraft/presets/swe-basic/flow.yaml
~/.oncraft/presets/swe-basic/states/Brainstorm/state.md
~/.oncraft/presets/swe-basic/states/Brainstorm/state.yaml
~/.oncraft/presets/swe-basic/states/Done/state.md
~/.oncraft/presets/swe-basic/states/Done/state.yaml
~/.oncraft/presets/swe-basic/states/Done/trigger.md
~/.oncraft/presets/swe-basic/states/Implement/state.md
~/.oncraft/presets/swe-basic/states/Implement/state.yaml
~/.oncraft/presets/swe-basic/states/Implement/trigger.md
~/.oncraft/presets/swe-basic/states/Plan/state.md
~/.oncraft/presets/swe-basic/states/Plan/state.yaml
~/.oncraft/presets/swe-basic/states/Plan/trigger.md
~/.oncraft/presets/swe-basic/states/Review/state.md
~/.oncraft/presets/swe-basic/states/Review/state.yaml
~/.oncraft/presets/swe-basic/states/Review/trigger.md
~/.oncraft/presets/swe-basic/states/Specify/state.md
~/.oncraft/presets/swe-basic/states/Specify/state.yaml
~/.oncraft/presets/swe-basic/states/Specify/trigger.md
```

- [ ] **Step 6: No git commit** — these files live in `~/.oncraft/`, not in the repo. They are user-level config.

---

### Task 10: Remove Hardcoded Defaults from config-loader.ts

**Files:**
- Modify: `app/services/config-loader.ts:1-93`

- [ ] **Step 1: Remove `DEFAULT_COLUMNS` and `DEFAULT_PIPELINES` constants**

These are now provided by the preset. Update `loadProjectConfig` and `createDefaultConfig` to receive defaults as parameters or import them from the preset.

Replace the hardcoded fallback in `loadProjectConfig` (line 42):
```typescript
return { columns: DEFAULT_COLUMNS, pipelines: DEFAULT_PIPELINES };
```

With a simpler fallback that returns empty config (the store will provide preset defaults):
```typescript
return { columns: [], pipelines: [] };
```

Update `createDefaultConfig` similarly — it should no longer write hardcoded defaults. The preset is the source of truth.

- [ ] **Step 2: Commit**

```bash
git add app/services/config-loader.ts
git commit -m "refactor(config): remove hardcoded column/pipeline defaults, defer to preset"
```
