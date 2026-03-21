# SWE Basic Preset — Design Spec

## Overview

Define the content of the default flow preset "swe-basic" located at `~/.oncraft/presets/swe-basic/`. This preset is automatically created on first run and applied by default to new projects.

## Preset Structure

```
~/.oncraft/presets/swe-basic/
├── flow.yaml              # Global config: name, agent defaults, stateOrder
├── flow.md                # Global system prompt
└── states/
    ├── Brainstorm/
    │   ├── state.yaml     # name, color, icon
    │   └── state.md       # System prompt for this state
    ├── Specify/
    │   ├── state.yaml     # name, color, icon, artifact
    │   ├── state.md       # System prompt for this state
    │   └── trigger.md     # Message sent on transition into this state
    ├── Plan/
    │   ├── state.yaml     # name, color, icon, artifact, requiredFiles
    │   ├── state.md
    │   └── trigger.md
    ├── Implement/
    │   ├── state.yaml     # name, color, icon, requiredFiles
    │   ├── state.md
    │   └── trigger.md
    ├── Review/
    │   ├── state.yaml     # name, color, icon, requiredFiles
    │   ├── state.md
    │   └── trigger.md
    └── Done/
        ├── state.yaml     # name, color, icon
        ├── state.md
        └── trigger.md
```

## Prompt Architecture

Three layers, each with a distinct role:

| Layer | File | Injection | Purpose |
|-------|------|-----------|---------|
| Global | `flow.md` | System prompt (always present) | Context of the full workflow |
| State | `state.md` | System prompt (while card is in this state) | Behavior rules for the current phase |
| Trigger | `trigger.md` | User message (sent once on state entry) | Action prompt for the transition |

**System prompt composition**: When a card is active, the effective system prompt is `flow.md` + the current state's `state.md`, concatenated in that order. This is injected via the `appendSystemPrompt` field in the sidecar's `query()` options (see Implementation Requirements below).

**Trigger delivery**: When a card transitions to a new state, the `trigger.md` content (after template resolution) is sent as a user message via `sessionsStore.send()`, same as existing pipeline prompts.

## Template Variables

Prompts support `{{ variable }}` templates resolved at runtime:

- `{{ session.name }}` — Card name
- `{{ session.id }}` — Session ID
- `{{ project.path }}` — Project directory path
- `{{ project.name }}` — Project name
- `{{ card.description }}` — Card description
- `{{ column.from }}` — Previous column name
- `{{ column.to }}` — Target column name
- `{{ card.linkedFiles.<key> }}` — Path of a linked file by key (e.g. `spec`, `plan`)

## Artifact Lifecycle

States that define an `artifact` key (e.g. `artifact: spec` on Specify) indicate that the agent should produce a file and link it to the card during that phase.

1. The agent creates the file and uses the `update_current_card` MCP tool to add it to the card's `linkedFiles` (e.g. `{ spec: "docs/spec.md" }`)
2. Once linked, subsequent states can reference the artifact via `{{ card.linkedFiles.spec }}` in their triggers
3. States with `requiredFiles` expect those linked file keys to already exist when the card enters that state

### `requiredFiles` Validation

When a card is dragged to a column whose state has `requiredFiles`:
- The frontend checks whether all required keys exist in `card.linkedFiles`
- If any are missing, the transition is **blocked** and a warning is shown indicating which files are missing
- The user can override the block if needed (e.g. via a confirmation dialog)

## Global Config

### `flow.yaml`

```yaml
name: "SWE Basic"
agent:
  model: sonnet
  effort: high
  permissionMode: default
stateOrder:
  - Brainstorm
  - Specify
  - Plan
  - Implement
  - Review
  - Done
```

Agent defaults apply to all states unless overridden per state.

### `flow.md`

```markdown
You are a software engineer working within OnCraft, a Kanban-driven development workflow. Each card represents a task or feature moving through the following lifecycle:

1. **Brainstorm** — Explore the idea, understand the problem, discuss approaches with the user.
2. **Specify** — Produce a formal specification document with requirements and acceptance criteria.
3. **Plan** — Create a detailed implementation plan with ordered steps and files to modify.
4. **Implement** — Write the code following the plan. Commit progress frequently.
5. **Review** — Review the implementation against the spec and plan. Identify issues.
6. **Done** — Work is complete.

Follow the instructions for your current state. When a state produces an artifact (e.g. spec.md, plan.md), save it and link it to the card. Always respond in the user's language.
```

## State Definitions

### Brainstorm

**`state.yaml`**:
```yaml
name: Brainstorm
color: "#a78bfa"
icon: i-lucide-lightbulb
```

**`state.md`**:
```markdown
You are in the Brainstorm phase. Your goal is to explore the idea with the user, understand the problem space, discuss possible approaches, and help reach a clear direction.

- Ask clarifying questions to understand scope and constraints
- Propose different approaches with trade-offs when relevant
- Keep the conversation exploratory — no need to produce formal documents
- When the idea is well understood, suggest moving to the Specify phase
```

**`trigger.md`**: None (initial state, user starts the conversation).

---

### Specify

**`state.yaml`**:
```yaml
name: Specify
color: "#60a5fa"
icon: i-lucide-file-text
artifact: spec
```

**`state.md`**:
```markdown
You are in the Specify phase. Your goal is to produce a clear, formal specification document.

- Define the problem statement and goals
- List functional requirements with acceptance criteria
- Identify constraints, edge cases, and out-of-scope items
- Save the specification to the artifact file linked to this state
- When the spec is complete and the user approves, suggest moving to the Plan phase
```

**`trigger.md`**:
```markdown
The card "{{ session.name }}" has moved to the Specify phase.

{{ card.description }}

Based on our previous discussion, create a formal specification document. Save it to {{ card.linkedFiles.spec }}. Include:
- Problem statement
- Requirements and acceptance criteria
- Constraints and out-of-scope items

Present the spec to the user for review before considering this phase complete.
```

---

### Plan

**`state.yaml`**:
```yaml
name: Plan
color: "#34d399"
icon: i-lucide-list-checks
artifact: plan
requiredFiles:
  - spec
```

**`state.md`**:
```markdown
You are in the Plan phase. Your goal is to create a detailed implementation plan based on the specification.

- Read the specification before planning
- Break the work into ordered, actionable steps
- Identify which files need to be created or modified
- Note dependencies between steps
- Save the plan to the artifact file linked to this state
- When the plan is complete and the user approves, suggest moving to the Implement phase
```

**`trigger.md`**:
```markdown
The card "{{ session.name }}" has moved to the Plan phase.

Read the specification at {{ card.linkedFiles.spec }} and create a detailed implementation plan. Save it to {{ card.linkedFiles.plan }}. Include:
- Ordered steps with clear descriptions
- Files to create or modify per step
- Dependencies between steps

Present the plan to the user for review before considering this phase complete.
```

---

### Implement

**`state.yaml`**:
```yaml
name: Implement
color: "#fbbf24"
icon: i-lucide-code
requiredFiles:
  - plan
```

**`state.md`**:
```markdown
You are in the Implement phase. Your goal is to write the code following the implementation plan.

- Read the plan before starting
- Work through steps in order
- Commit progress frequently with clear commit messages
- If you encounter issues that contradict the plan or spec, flag them to the user
- When implementation is complete, suggest moving to the Review phase
```

**`trigger.md`**:
```markdown
The card "{{ session.name }}" has moved to the Implement phase.

{{ card.description }}

Read the implementation plan at {{ card.linkedFiles.plan }} and work through it systematically. Commit progress frequently.
```

---

### Review

**`state.yaml`**:
```yaml
name: Review
color: "#f472b6"
icon: i-lucide-search-check
requiredFiles:
  - spec
  - plan
```

**`state.md`**:
```markdown
You are in the Review phase. Your goal is to review the implementation against the specification and plan.

- Verify that all requirements from the spec are met
- Check that the plan was followed
- Run tests if available
- Identify bugs, missing edge cases, or deviations from the spec
- Report findings to the user
- When the review is satisfactory, suggest moving to Done
```

**`trigger.md`**:
```markdown
The card "{{ session.name }}" has moved to the Review phase.

Review the implementation against the specification at {{ card.linkedFiles.spec }} and the plan at {{ card.linkedFiles.plan }}. Run tests if available. Report any issues found.
```

---

### Done

**`state.yaml`**:
```yaml
name: Done
color: "#22c55e"
icon: i-lucide-circle-check
```

**`state.md`**:
```markdown
You are in the Done phase. Your goal is to prepare the work for integration into the main branch.

- Ensure all changes are committed
- Clean up commit history: group related commits into logical units that tell a clear story (not necessarily a single squash — use your judgment)
- Rebase onto master and resolve any conflicts
- Verify the build and tests still pass after rebase
```

**`trigger.md`**:
```markdown
The card "{{ session.name }}" has moved to Done.

Before closing, prepare the branch for integration:
1. Check for uncommitted changes and commit them
2. Review the commit history — if there are too many iteration commits, consolidate them into logical groups that make sense
3. Rebase onto master and resolve any conflicts
4. Verify the build and tests pass
```

## New Fields in `state.yaml`

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name of the state |
| `color` | string | Hex color for the Kanban column |
| `icon` | string | Lucide icon identifier (e.g. `i-lucide-lightbulb`) |
| `artifact` | string | Key name for the linked file this state produces (e.g. `spec`, `plan`) |
| `requiredFiles` | string[] | Linked file keys that must exist before entering this state |

## Implementation Requirements

### 1. Preset Loader

Create a service to read presets from `~/.oncraft/presets/<name>/`:
- Parse `flow.yaml` for global config and state order
- Read `flow.md` for the global system prompt
- For each state in `stateOrder`, read `states/<name>/state.yaml`, `state.md`, and `trigger.md` (all optional except `state.yaml`)
- The loaded preset replaces the current hardcoded defaults in `config-loader.ts` and `pipelines.ts`

### 2. Preset-to-Project Mapping

When a new project is created:
- Apply the default preset (`swe-basic`) to generate the project's column and pipeline config
- The project's `.oncraft/config.yaml` stores a reference to the preset name, not a copy of it
- The project can override preset values if needed

### 3. System Prompt Injection

The sidecar must support injecting the system prompt (`flow.md` + current `state.md`) into the Claude session:
- Extend the sidecar's `start` command to accept a `systemPrompt` or `appendSystemPrompt` field
- Pass it to the SDK's `query()` options
- The frontend composes the system prompt from the preset's `flow.md` + the current state's `state.md` and sends it with each `start` command

### 4. Template Engine Extension

The current `resolveTemplate` regex (`/\{\{(\w+)\.(\w+)\}\}/g`) needs two fixes:
- **Whitespace tolerance**: support `{{ var.key }}` with optional spaces → update regex to `/\{\{\s*(\w+(?:\.\w+)+)\s*\}\}/g`
- **Nested property access**: support `{{ card.linkedFiles.spec }}` (3+ levels) → walk the property path dynamically instead of only supporting two levels

Also extend `TemplateContext` to include `card.linkedFiles`:
```typescript
export interface TemplateContext {
  session: { name: string; id: string };
  project: { path: string; name: string };
  card: { description: string; linkedFiles: Record<string, string> };
  column: { from: string; to: string };
}
```

### 5. Trigger Delivery (replaces pipelines)

The existing pipeline mechanism in `KanbanColumn.vue` (find pipeline → resolve template → send) should be replaced by:
- On column transition: look up the target state's `trigger.md` from the loaded preset
- Resolve templates (with the extended engine)
- Send via `sessionsStore.send()`

The existing `PipelineConfig` and `findPipeline()` become the legacy fallback for projects not using presets.

### 6. `requiredFiles` Validation in Frontend

Add validation in `KanbanColumn.vue` drag handler:
- Before completing a column transition, check if the target state has `requiredFiles`
- Verify all required keys exist in the card's `linkedFiles`
- If missing, block the transition and show a warning with the missing file keys
- Optionally allow the user to override via confirmation dialog

### 7. Icon Support on Kanban Columns

- Add `icon` field to the column/state data model
- Render the icon (via `UIcon`) in the Kanban column header alongside the column name
- Fall back gracefully if no icon is set
