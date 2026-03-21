# Flow System Design

## Summary

Replace the current flat `ProjectConfig` (columns + pipelines) with a rich **Flow** system that controls agent behavior contextually based on a card's position in the Kanban board. A Flow defines the board structure, default agent configuration, and available resources. Each FlowState (column) can override agent settings, activate specific tools/agents/skills/MCPs, define behavioral prompts, and enforce preconditions on cards entering the state.

## Motivation

The current model is limited:
- `ColumnConfig` only stores `name` and `color` — no behavioral semantics.
- `PipelineConfig` only stores `from`, `to`, and a `prompt` template — no agent configuration, no preconditions, no tool control.
- The sidecar passes `model`, `effort`, `permissionMode` to the SDK but does not use `systemPrompt`, `allowedTools`, `disallowedTools`, `mcpServers`, or `agents`.

The Claude Agent SDK supports all of these options per `query()` call. The Flow system leverages them to make each board column a contextual agent configuration.

## Design Principles

1. **`.claude/` = base always active** — what Claude Code loads natively (agents, skills, MCPs, settings) is always available regardless of Flow configuration.
2. **`.oncraft/` = contextual layer** — OnCraft injects additional configuration based on the card's position in the Flow.
3. **Reference, don't redefine** — agents/skills are referenced by name from `.oncraft/` configuration. They live in the Claude Code ecosystem (`.claude/agents/`, `.claude/skills/`, plugins). OnCraft orchestrates which activate when.
4. **Permissive with warnings** — broken references (missing agents, MCPs that won't start, unknown tools) never block the user. Warnings appear contextually in the UI. The only hard precondition is `requiredFiles`.
5. **Layered inheritance** — configuration merges through up to 5 layers: `.claude/` (always active) + Preset base (if referenced) + Project Flow overrides + FlowState overrides + Card overrides (user adjustments via chat UI). Without presets, it reduces to 4 layers.

## Data Model

### McpServerConfig

Configuration for an MCP server. Matches the SDK's `McpServerConfig` type.

```typescript
interface McpServerConfig {
  command: string;              // e.g. "npx", "node"
  args?: string[];              // e.g. ["-y", "@sonarqube/mcp-server"]
  env?: Record<string, string>; // additional environment variables
  // Transport type is inferred: stdio (default for command-based)
}
```

### AgentConfig

Shared configuration block for SDK `query()` options. Used at Flow and FlowState level.

```typescript
interface AgentConfig {
  model?: ModelAlias;           // 'sonnet' | 'opus' | 'haiku'
  effort?: EffortLevel;         // 'low' | 'medium' | 'high' | 'max'
  permissionMode?: PermissionMode; // 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'
  verbosity?: VerbosityLevel;   // from existing SessionConfig
}
```

### Flow

Top-level configuration for the board. One Flow per project. Stored in `.oncraft/flow.yaml`.

```typescript
interface Flow {
  name: string;                          // "Feature Development"
  preset?: string;                       // Reference to preset name (e.g. "swe-basic")

  // Defaults for all sessions (base inheritance layer)
  agent: AgentConfig;

  // Resources available across the entire Flow (additive to .claude/)
  agents: string[];                      // refs by name
  skills: string[];                      // refs by name
  mcpServers: Record<string, McpServerConfig>;

  // Tool control
  tools: {
    allowed: string[];
    disallowed: string[];
  };

  // Column order on the board (references to state directory names)
  stateOrder: string[];

  // Populated from filesystem (states/*/state.yaml)
  states: FlowState[];
}
```

### FlowState

Configuration for a single board column. Stored in `.oncraft/states/<slug>/state.yaml`.

```typescript
interface FlowState {
  slug: string;                          // directory name, internal identifier
  name: string;                          // display name: "Review"
  color: string;                         // "#f472b6"
  icon?: string;                         // Iconify name, e.g. "heroicons:magnifying-glass"

  // Override agent config (inherits from Flow if not specified)
  agent?: Partial<AgentConfig>;

  // Additional resources for this state (additive to Flow level)
  agents?: string[];
  skills?: string[];
  mcpServers?: Record<string, McpServerConfig>;

  // Tool control for this state
  tools?: {
    allowed?: string[];
    disallowed?: string[];
  };

  // Hard precondition: linked file slots that must be assigned on the card
  requiredFiles?: string[];

  // Prompts (loaded from .md files in the state directory)
  prompt?: string;                       // from prompt.md — behavioral prompt
  triggerPrompt?: string;                // from trigger.md — sent on card move
}
```

### Inheritance Model

```
.claude/ (always active — native Claude Code)
    + complemented by
Preset base (~/.oncraft/presets/<name>/ — if referenced)
    + overridden/extended by
Project Flow (.oncraft/flow.yaml → agent, agents, skills, mcpServers, tools)
    + overridden by
FlowState (.oncraft/states/X/state.yaml → agent, agents, skills, mcpServers, tools)
    + overridden by
Card (user adjustments in chat UI: model, effort, permissionMode)
```

Without presets, the Preset layer is absent and the chain starts at Project Flow.

#### Merge rules by field type

| Field | Merge behavior |
|-------|---------------|
| `agent` (model, effort, permissionMode) | Deep merge — each layer overrides individual fields |
| `agents`, `skills` | Additive — each layer adds to the set |
| `mcpServers` | Additive — each layer adds servers (same name = override) |
| `tools.allowed` | Additive — each layer adds rules |
| `tools.disallowed` | Additive — each layer adds restrictions |

**Conflict resolution:** If the same tool appears in both `allowed` and `disallowed` after merging all layers, `disallowed` wins. This matches the Claude Agent SDK behavior where deny rules are checked first and override allow rules.

## Filesystem Structure

### Project configuration

```
<project>/
  .claude/                              # Native Claude Code (always loaded)
    settings.json
    agents/
    skills/
    commands/
    CLAUDE.md
  .oncraft/                             # OnCraft Flow layer
    flow.yaml                           # Flow config + stateOrder + defaults
    flow.md                             # System prompt (injected in all sessions)
    states/
      brainstorm/
        state.yaml                      # State config
        prompt.md                       # Behavioral prompt for this state
        trigger.md                      # (optional) Sent when card moves here
      specify/
        state.yaml
        prompt.md
        trigger.md
      plan/
        state.yaml
        prompt.md
      implement/
        state.yaml
        prompt.md
        trigger.md
      review/
        state.yaml
        prompt.md
      done/
        state.yaml
```

### User-level presets

```
~/.oncraft/
  presets/
    swe-basic/                          # Same structure as .oncraft/
      flow.yaml
      flow.md
      states/
        backlog/
          state.yaml
          prompt.md
        in-progress/
          state.yaml
          prompt.md
          trigger.md
        review/
          state.yaml
          prompt.md
        done/
          state.yaml
    open-source-contrib/
      flow.yaml
      flow.md
      states/
        ...
```

A preset has exactly the same structure as a project's `.oncraft/` directory.

## Presets

### Referencing a preset

A project references a preset in `.oncraft/flow.yaml`:

```yaml
preset: swe-basic
```

Or with local overrides:

```yaml
preset: swe-basic

agent:
  model: opus

mcpServers:
  project-docs:
    command: "node"
    args: ["./tools/docs-mcp.js"]
```

### Preset resolution

When a project references a preset, the configuration resolves as:

```
~/.oncraft/presets/<name>/             <- Preset (base)
    + overridden/extended by
<project>/.oncraft/                    <- Project (overrides)
```

### Preset merge rules

| Field | Behavior |
|-------|----------|
| `agent` | Deep merge — project overrides individual fields |
| `agents`, `skills` | Additive — project adds to preset |
| `mcpServers` | Additive — project adds servers |
| `tools.allowed/disallowed` | Additive — project adds rules |
| `stateOrder` | **Replacement** — if project defines it, replaces preset's |
| `flow.md` | **Replacement** — if project has `flow.md`, replaces preset's |
| `states/X/state.yaml` | Deep merge — project overrides individual state fields |
| `states/X/prompt.md` | **Replacement** — project file replaces preset file |
| `states/X/trigger.md` | **Replacement** — project file replaces preset file |

### State resolution

For each state in `stateOrder`:
1. Look in `<project>/.oncraft/states/<slug>/`
2. If not found, look in `~/.oncraft/presets/<name>/states/<slug>/`
3. If not found in either, use defaults (warning: unconfigured state)

Projects can add new states (must appear in their `stateOrder`) and override individual files of preset states.

### Eject

When overrides become extensive, the user can "eject" — copying the entire preset into the project's `.oncraft/` and removing the `preset:` reference. After eject, the project is fully independent.

## System Prompt Composition

The system prompt sent to the SDK composes as:

```
Claude Code preset system prompt (via settingSources: ['user', 'project'])
  + flow.md (general Flow prompt)
  + states/X/prompt.md (current FlowState behavioral prompt)
```

Passed to the SDK as:
```typescript
systemPrompt: {
  type: 'preset',
  preset: 'claude_code',
  append: flowPrompt + '\n\n' + statePrompt
}
```

## Trigger Prompts

When a card moves to a FlowState that has a `trigger.md`, that prompt is sent as an automatic user message, initiating a new `query()`. Trigger prompts support the template system with the following variables:

- `{{ session.name }}` — card name
- `{{ session.id }}` — card ID
- `{{ card.description }}` — card description
- `{{ session.files.plan }}` — path to the linked file with label "plan"
- `{{ session.files.spec }}` — path to the linked file with label "spec"
- `{{ project.path }}` — project directory path
- `{{ project.name }}` — project name

### Template engine changes required

The current template engine (`template-engine.ts`) uses a regex that only supports two-level access (`{{ group.key }}`). The `session.files.*` pattern requires three-level access. The template engine must be extended to support nested property access (e.g. `{{ session.files.plan }}` resolves via dot-path traversal).

The `TemplateContext` type must be updated to include `files`:

```typescript
interface TemplateContext {
  session: {
    name: string;
    id: string;
    files: Record<string, string>;  // label → file path
  };
  project: { path: string; name: string };
  card: { description: string };
}
```

**Trigger guard:** Trigger prompts fire only on user-initiated card moves (drag-and-drop or explicit UI action). If a future extension adds programmatic/automated card moves, a recursion guard must prevent trigger chains (trigger on state A moves card to state B, which triggers again, etc.). For V1, this is not a concern since all moves are manual.

Note: the current `column: { from: string; to: string }` context variable from the pipeline system is removed. The new Flow model uses per-state triggers instead of directional transitions, so `column.from`/`column.to` no longer apply. Existing pipeline prompt templates that use these variables will need manual updating during migration.

## Required Files (Preconditions)

If a FlowState defines `requiredFiles: [spec, plan]`, moving a card to that state requires those linked file slots to be assigned on the card. This is the **only hard precondition** — it blocks the card move.

The UI should:
1. Show which slots are missing when the move is blocked.
2. Allow the user to assign the files inline before completing the move.

### Prerequisite: linkedFiles persistence

The `Card.linkedFiles` field exists in the TypeScript interface but is **not currently persisted to SQLite**. Implementation requires:
1. A database migration adding a `linked_files TEXT` column to the `cards` table (JSON-serialized `Record<string, string>`).
2. Updates to `database.ts` (`insertCard`, `updateCard`, `getCardsByProject`) to serialize/deserialize this field.
3. UI for managing linked files on cards (assigning file paths to named slots).

This is a prerequisite for both `requiredFiles` validation and `session.files.*` template resolution.

## Runtime Store

The resolved `Flow` object is held in a new Pinia store (`useFlowStore`) that replaces the current `usePipelinesStore`. Key responsibilities:

- **Load the Flow** on project open (from filesystem via `flow-loader.ts`).
- **Resolve presets** — merge preset base with project overrides.
- **Expose getters**: `getFlowState(slug)`, `stateOrder`, `resolvedConfigForCard(cardId)` (merges Flow + FlowState + Card overrides).
- **Track validation warnings** — per-Flow and per-FlowState warning arrays.
- **Reactivity** — components bind to the store; `KanbanColumn` gets its `FlowState` via `getFlowState(column.slug)`.

### Card `columnName` maps to FlowState `slug`

The `Card.columnName` field in the database stores the **FlowState slug** (directory name), not the display name. This is the stable internal identifier. If a user renames a FlowState's display `name` in `state.yaml`, no card migration is needed. If a state directory is renamed (slug change), cards referencing the old slug become orphaned — this is treated as a **warning** (cards shown in an "Unknown" column with a prompt to reassign).

## Validation and Warnings

### Warning sources

| Scope | Condition | UI location |
|-------|-----------|-------------|
| Flow | Referenced agent/skill not found | Project tab badge |
| Flow | MCP server config invalid | Project tab badge |
| FlowState | Referenced agent/skill not found | Next to state name in column header |
| FlowState | MCP server config invalid | Next to state name in column header |
| FlowState | `prompt.md` or `trigger.md` missing but referenced | Next to state name |
| Card → State | `requiredFiles` not satisfied | **Blocks move** (hard precondition) |
| Session start | Agent/MCP/tool doesn't resolve at runtime | Warning in chat, session starts without it |
| Card | Card's `columnName` slug not in `stateOrder` | Card shown in "Unknown" column with reassign prompt |

### Validation timing

- **Project load** — full Flow validation, populate warnings
- **Config file change** — re-validate affected scope
- **Card move** — validate `requiredFiles` (hard gate)
- **Session start** — runtime resolution check (soft warning)

## Configuration Examples

### `flow.yaml`

```yaml
name: "Feature Development"

agent:
  model: sonnet
  effort: high
  permissionMode: default

agents:
  - plan-writer

skills:
  - brainstorming

mcpServers:
  design-system:
    command: "node"
    args: ["./tools/design-mcp.js"]

tools:
  allowed: []
  disallowed: []

stateOrder:
  - brainstorm
  - specify
  - plan
  - implement
  - review
  - done
```

### `states/review/state.yaml`

```yaml
name: Review
color: "#f472b6"
icon: "magnifying-glass"

agent:
  model: opus
  effort: high
  permissionMode: acceptEdits

agents:
  - code-reviewer

skills:
  - code-review

tools:
  allowed:
    - "Read"
    - "Grep"
    - "Glob"
  disallowed:
    - "Write"
    - "Edit"

mcpServers:
  sonarqube:
    command: "npx"
    args: ["-y", "@sonarqube/mcp-server"]

requiredFiles:
  - spec
  - plan
```

### `states/review/prompt.md`

```markdown
You are in the **Review** phase. Your role is to critically review the implementation
against the specification and plan.

Focus on:
- Correctness: does the implementation match the spec?
- Quality: code style, error handling, edge cases
- Security: no vulnerabilities introduced
- Performance: no obvious bottlenecks

Use the code-reviewer agent for detailed analysis. Prioritize the Read, Grep, and Glob
tools for exploration. Do NOT make edits — only report findings.
```

### `states/implement/trigger.md`

```markdown
The card "{{ session.name }}" has moved to the Implementation phase.

Read the implementation plan at {{ session.files.plan }} and begin executing it.
The specification is at {{ session.files.spec }} for reference.

Work through the plan systematically, implementing one section at a time.
```

## SDK Integration

### Agent and skill resolution

When the Flow or FlowState references an agent by name (e.g. `code-reviewer`), OnCraft must resolve it to an `AgentDefinition` object for the SDK. Resolution order:

1. **`.claude/agents/<name>.md`** — project-level agent definition (`.md` with YAML frontmatter: `name`, `description`, `model`, and prompt body).
2. **`~/.claude/agents/<name>.md`** — user-level agent definition.
3. **Plugin cache** — `~/.claude/plugins/cache/*/agents/<name>.md`.

The `.md` file is parsed: frontmatter provides `description` and `model`, the body provides the `prompt`. The `tools`, `disallowedTools`, `mcpServers`, and `skills` fields from `AgentDefinition` are not part of the `.md` format — they remain empty unless the Flow YAML provides them inline (future extension).

For **skills**, the reference is passed as a string to the SDK's `skills` option on the `AgentDefinition` or top-level `query()` options. The SDK resolves skill names internally from the Claude Code filesystem (`.claude/skills/`, plugins). OnCraft does not need to resolve skill contents itself.

If an agent name cannot be resolved, a **warning** is generated and the agent is omitted from the `query()` options. The session starts without it.

### Sidecar protocol changes

The frontend composes the resolved Flow configuration and sends it to the sidecar as part of the `start` command over JSON-over-stdin. Currently the `start` command includes `model`, `effort`, `permissionMode`, and `worktreeName`. The following new fields are added:

```typescript
// New fields in the "start" command payload (frontend → sidecar)
interface StartCommand {
  cmd: "start";
  prompt: string;
  projectPath: string;
  sessionId?: string;
  // Existing fields
  model?: string;
  effort?: string;
  permissionMode?: string;
  worktreeName?: string;
  imagePaths?: { path: string; mediaType: string }[];
  // New Flow fields
  systemPromptAppend?: string;          // composed flow.md + state prompt.md
  allowedTools?: string[];              // merged from all layers
  disallowedTools?: string[];           // merged from all layers
  agents?: Record<string, {             // resolved AgentDefinition objects
    description: string;
    prompt: string;
    tools?: string[];
    disallowedTools?: string[];
    model?: string;
    mcpServers?: string[];
    skills?: string[];
    maxTurns?: number;
  }>;
  mcpServers?: Record<string, {         // merged MCP server configs
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}
```

The sidecar maps these fields directly to the SDK's `query()` options. The composition and merge logic happens **in the frontend** (in `flow-loader.ts` and `claude-process.ts`), not in the sidecar. The sidecar remains a thin pass-through.

### Composing `query()` options

When starting or resuming a session for a card, the sidecar receives the composed configuration and passes it to the SDK:

```typescript
const options = {
  // Base
  pathToClaudeCodeExecutable: cliPath,
  executable: "node",
  env: claudeEnv,
  cwd: projectPath,
  settingSources: ["user", "project"],  // loads .claude/ natively

  // From Flow + FlowState + Card (merged)
  model: resolvedConfig.model,
  effort: resolvedConfig.effort,
  permissionMode: resolvedConfig.permissionMode,

  // System prompt: Flow prompt + FlowState prompt
  systemPrompt: {
    type: "preset",
    preset: "claude_code",
    append: composedPrompt,
  },

  // Tools: merged from all layers
  allowedTools: resolvedConfig.allowedTools,
  disallowedTools: resolvedConfig.disallowedTools,

  // Agents: merged from all layers, resolved to AgentDefinition objects
  agents: resolvedConfig.agents,

  // MCPs: merged from all layers
  mcpServers: resolvedConfig.mcpServers,

  // Skills: merged from all layers
  // (passed via agents or direct skill references)

  // Existing options
  resume: sessionId,
  abortController: currentAbort,
  includePartialMessages: true,
  canUseTool: async (toolName, input, options) => { /* ... */ },
};
```

## Migration from Current Model

### What changes

| Current | New |
|---------|-----|
| `ProjectConfig.columns: ColumnConfig[]` | `Flow.stateOrder` + `FlowState[]` from filesystem |
| `ProjectConfig.pipelines: PipelineConfig[]` | `FlowState.triggerPrompt` (trigger.md per state) |
| `ColumnConfig { name, color }` | `FlowState { name, color, icon, agent, tools, ... }` |
| `.oncraft/config.yaml` (single file) | `.oncraft/flow.yaml` + `states/*/state.yaml` + `*.md` |
| Config loaded via `config-loader.ts` | New `flow-loader.ts` service |

### What stays the same

- Card data model (add: nothing changes in DB schema for cards)
- Session management (sessions store, claude-process service)
- Chat modes (integrated + console)
- Card linked files (used by `requiredFiles` and template system)

### Migration path

1. New projects get the new `.oncraft/` structure (generated from a built-in default preset or user-selected preset).
2. Existing projects with `.oncraft/config.yaml` are auto-migrated on project load:
   - **Timing**: migration runs in `flow-loader.ts` when it detects `config.yaml` exists but no `flow.yaml`.
   - **Columns → States**: each `ColumnConfig { name, color }` becomes a `states/<slug>/state.yaml` with the slug derived from the name (lowercased, spaces to hyphens).
   - **Pipelines → Triggers**: each `PipelineConfig { from, to, prompt }` becomes a `states/<to-slug>/trigger.md` containing the prompt. If multiple pipelines target the same state (e.g. A→C and B→C), only the first pipeline's prompt is used (with a warning logged).
   - **Backup**: the original `config.yaml` is renamed to `config.yaml.bak` (not deleted).
   - **Card columnName update**: existing cards' `columnName` values are remapped to the new slug format. This is a DB migration that runs alongside the filesystem migration.
3. The `config-loader.ts` service is replaced by a new `flow-loader.ts` that reads the directory structure.
4. The `usePipelinesStore` is replaced by `useFlowStore`.
5. `GlobalSettings.defaultColumns` is superseded by the preset system. The field is kept for backward compatibility but ignored when a Flow is present.

## GitHub Config

The current `ProjectConfig.github` field (`GitHubConfig { repository?: string }`) is not part of the Flow model — it is project-level metadata independent of the Flow. It moves to a separate `project.yaml` in `.oncraft/` or remains in the database as project-level settings. This is an orthogonal concern and does not block the Flow implementation.

## Future Extensions (Out of Scope for V1)

- **Preset distribution** — sharing presets via a registry/marketplace (V2).
- **Flow editor UI** — visual editor for Flow configuration (currently manual YAML/MD editing).
- **Conditional transitions** — rules for which states a card can move to from a given state.
- **Auto-generated linked files** — FlowState trigger creates linked files automatically if slots are empty.
- **Flow analytics** — tracking time spent per state, throughput metrics.
- **File watching** — auto-revalidate Flow on `.oncraft/` file changes (currently requires project reload).
- **Eject UI** — dedicated UI button to eject a preset into a standalone Flow, with merge of existing project overrides.
- **Inline agent definitions** — allow `AgentDefinition` fields (`tools`, `disallowedTools`, `mcpServers`) in Flow YAML for agents that don't exist as `.md` files.
