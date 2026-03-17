# OnCraft - Design Specification

**Date**: 2026-03-15
**Status**: Approved

## Overview

OnCraft is a desktop application for managing Claude Code sessions as a Kanban board. Each column represents a development phase, each card represents a Claude Code session, and moving cards between columns triggers configurable prompt pipelines.

## Architecture

### Stack

- **Frontend**: Vue 3 (Composition API) + TypeScript
- **Desktop Shell**: Tauri (Rust)
- **Claude Code Integration**: CLI in `--output-format stream-json` mode, spawned as child processes from Tauri
- **Persistence**: Hybrid
  - `.oncraft/config.yaml` per project (columns, pipeline templates) — git-trackable
  - `~/.oncraft/oncraft.db` SQLite centralized (cards, sessions, state)

### Conceptual Model

```
Tab       = Project (filesystem directory)
Column    = Development phase (configurable per project)
Card      = A unit of work tracked on the board. Each card is backed by exactly
            one Claude Code session. A card cannot exist without a session, and
            every session has exactly one card. "Card" refers to the UI element,
            "session" to the underlying Claude Code process/history.
Pipeline  = Prompt template triggered when moving a card between columns
```

## Layout and Navigation

### Main View: Tabs + Split Panel

- **Tab bar** at the top — each tab is a project (directory)
- **Active tab** shows the Kanban board at full width
- **Clicking a card** opens a right-side chat panel with that session. The board compresses to the left. Divider is resizable.
- **"+" button** in tabs to add a project (native OS directory picker)

### Kanban Board

- Columns configurable per project, horizontal scroll if many columns
- Standard cards: name, short description, session ID, time since last activity, active/idle indicator, optional tags
- Drag & drop to move cards between columns — dropping triggers the configured pipeline

### Chat Panel (lateral)

- Header: session name, current phase, close button
- Messages rendered with custom UI (parsed from Claude Code stream-json)
- Text input at the bottom for sending prompts
- Tool calls and results shown collapsible with a summary (e.g., "Read file: src/main.ts") — expandable for detail
- When Claude awaits tool confirmation, approve/reject buttons in the UI
- Closing the chat panel while a session is running does not stop the process — it continues in background. A spinning indicator on the card shows that a pipeline or session is actively running.
- Cards within a column are ordered by last activity (most recent at top). Manual drag reorder within a column is supported.

## Pipeline System

### Configuration (`.oncraft/config.yaml`)

```yaml
columns:
  - name: Brainstorm
    color: "#a78bfa"
  - name: Specify
    color: "#60a5fa"
  - name: Plan
    color: "#34d399"
  - name: Implement
    color: "#fbbf24"
  - name: Review
    color: "#f472b6"
  - name: Done
    color: "#22c55e"

pipelines:
  - from: Brainstorm
    to: Specify
    prompt: |
      Based on our brainstorming in session {{session.name}},
      create a formal specification. Use /speckit-specify with
      the requirements we discussed.
      Project: {{project.path}}

  - from: Specify
    to: Plan
    prompt: |
      Review the specification and create an implementation
      plan using /speckit-plan for {{session.name}}.
```

### Template Variables

| Variable | Description |
|----------|-------------|
| `{{session.name}}` | Card/session name |
| `{{session.id}}` | Claude Code session ID |
| `{{project.path}}` | Project directory path |
| `{{project.name}}` | Project name |
| `{{card.description}}` | Card description |
| `{{column.from}}` | Source column |
| `{{column.to}}` | Destination column |

### Configuration Validation

When loading `.oncraft/config.yaml`, OnCraft validates:
- All pipeline `from`/`to` values reference existing column names. Invalid references produce a warning in the settings panel and the pipeline is disabled.
- Duplicate pipelines for the same `from`/`to` pair are rejected; only the first is kept.
- Column names must be unique and non-empty.

### Behavior on Card Move

1. User drags card from one column to another
2. OnCraft checks if a pipeline is configured for that transition
3. If exists:
   - If the session is Idle (no running process), OnCraft auto-resumes it with `claude --resume <session-id> --output-format stream-json` first
   - Resolves template variables, sends the prompt to the Claude Code session
   - Opens the chat panel automatically so the user sees the execution
   - A spinning indicator appears on the card while the pipeline prompt is being processed
4. If not: moves the card without executing anything

## Session Management

### Creating a Session

- "+" button inside a column (or general "New session" button)
- User provides a name and optional description
- OnCraft spawns a `claude` process with `--output-format stream-json` in the project directory via Tauri
- Card appears in the column where it was created
- If the `claude` binary is not found (not in PATH and not configured in global settings), OnCraft shows an error prompting the user to install Claude Code or configure the binary path in settings

### Session Lifecycle

| State | Indicator | Description |
|-------|-----------|-------------|
| Active | Green dot | Claude Code process running, user can chat |
| Idle | Gray dot | Session exists but no active process. User can reactivate and continue with `claude --resume` |
| Completed | — | In "Done" column, can be archived |

**State transitions:**
- **Active -> Idle**: The Claude Code process exits (naturally after completing a response, or unexpectedly via crash/signal). OnCraft detects process exit and updates the card indicator.
- **Idle -> Active**: User sends a message in the chat panel, or a pipeline triggers on card move. OnCraft spawns `claude --resume <session-id> --output-format stream-json`.
- **Any -> Completed**: User moves card to the "Done" column (or whichever column is last). Process is terminated if still active.
- **Process crash handling**: If the process exits with a non-zero code, the card shows an error indicator (red dot). The user can retry by sending a new message, which re-spawns the process.

**Archiving**: Out of scope for v1. Cards in "Done" remain visible. Future versions may add archive/hide functionality.

### Chat Interaction

- User types in input, OnCraft sends the text via stdin to the Claude Code process using the `stream-json` input protocol (newline-delimited JSON messages)
- The `stream-json` output is parsed in real-time. Key message types rendered:
  - `assistant` — text messages from Claude, rendered as chat bubbles
  - `user` — user messages, rendered as chat bubbles
  - `tool_use` — tool calls, rendered collapsed with a summary (name + key argument). Expandable for full input/output.
  - `tool_result` — tool execution results, shown inside the expanded tool call
  - `system` — system messages, rendered as subtle info banners
- If Claude awaits tool confirmation, approve/reject buttons appear in the UI

### Multiple Sessions

- Each card is an independent process
- Only one session visible at a time in the chat panel
- Multiple can run in background (green indicator visible on the board)

## Project Configuration

### First-Time Setup

- OnCraft detects if `.oncraft/config.yaml` exists in the directory
- If not: offers to create one with a default template (6 standard columns + suggested pipelines)
- If exists: loads it directly

### Project Settings Panel (accessible from tab icon)

- Column editor: add, remove, rename, reorder, change color
  - Deleting a column that still has cards requires confirmation. Cards are moved to the previous column (or first column if none).
  - Renaming a column auto-updates any pipeline references to that column name.
- Pipeline editor: select transition (from -> to), edit prompt template with syntax highlighting for `{{...}}` variables
- Project path (read-only)

### Global App Settings (`~/.oncraft/settings.yaml`)

- Path to `claude` binary (if not in PATH)
- Visual theme (dark by default, possible light)
- Default behavior for new projects (default column template)

## Data Model (SQLite: `~/.oncraft/oncraft.db`)

### Tables

**projects**
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| name | TEXT | Display name (derived from directory name) |
| path | TEXT UNIQUE | Absolute path to project directory |
| created_at | DATETIME | When the project was added |
| last_opened_at | DATETIME | For tab ordering |

**cards**
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| project_id | TEXT FK | References projects.id |
| name | TEXT | Card display name |
| description | TEXT | Optional short description |
| column_name | TEXT | Current column in the Kanban |
| column_order | INTEGER | Position within the column (for manual reorder) |
| session_id | TEXT | Claude Code session ID (for `--resume`) |
| state | TEXT | "active", "idle", "error", "completed" |
| tags | TEXT | JSON array of tag strings |
| created_at | DATETIME | When the card was created |
| last_activity_at | DATETIME | Updated on every session interaction |

## Decisions Log

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| Desktop framework | Tauri | Lightweight (~5-10MB), native webview, Rust backend, multi-window support |
| Frontend framework | Vue 3 | User preference |
| Layout | Tabs + Split panel | Tabs for projects, split for board + chat simultaneously |
| Columns | Configurable per project | Different projects have different workflows |
| Card density | Standard | Balance between info and space |
| Pipeline trigger | Prompt template with variables | Simple to configure, dynamic context |
| Claude integration | CLI stream-json | Full Claude Code ecosystem (skills, hooks, MCP), structured output |
| Persistence | Hybrid (files + SQLite) | Config is git-trackable, state is efficient |
