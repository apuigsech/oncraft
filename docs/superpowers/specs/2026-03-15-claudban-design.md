# ClaudBan - Design Specification

**Date**: 2026-03-15
**Status**: Approved

## Overview

ClaudBan is a desktop application for managing Claude Code sessions as a Kanban board. Each column represents a development phase, each card represents a Claude Code session, and moving cards between columns triggers configurable prompt pipelines.

## Architecture

### Stack

- **Frontend**: Vue 3 (Composition API) + TypeScript
- **Desktop Shell**: Tauri (Rust)
- **Claude Code Integration**: CLI in `--output-format stream-json` mode, spawned as child processes from Tauri
- **Persistence**: Hybrid
  - `.claudban/config.yaml` per project (columns, pipeline templates) — git-trackable
  - `~/.claudban/claudban.db` SQLite centralized (cards, sessions, state)

### Conceptual Model

```
Tab       = Project (filesystem directory)
Column    = Development phase (configurable per project)
Card      = Claude Code session
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

## Pipeline System

### Configuration (`.claudban/config.yaml`)

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

### Behavior on Card Move

1. User drags card from one column to another
2. ClaudBan checks if a pipeline is configured for that transition
3. If exists: resolves template variables, sends the prompt to the Claude Code session, opens chat panel automatically so the user sees the execution
4. If not: moves the card without executing anything

## Session Management

### Creating a Session

- "+" button inside a column (or general "New session" button)
- User provides a name and optional description
- ClaudBan spawns a `claude` process with `--output-format stream-json` in the project directory via Tauri
- Card appears in the column where it was created

### Session Lifecycle

| State | Indicator | Description |
|-------|-----------|-------------|
| Active | Green dot | Claude Code process running, user can chat |
| Idle | Gray dot | Session exists but no active process. User can reactivate and continue with `claude --resume` |
| Completed | — | In "Done" column, can be archived |

### Chat Interaction

- User types in input, ClaudBan sends text as stdin to the Claude Code process
- Stream-json is parsed in real-time and rendered as messages (assistant, user, tool calls, tool results)
- Tool calls shown collapsed with summary — expandable for detail
- If Claude awaits tool confirmation, approve/reject buttons appear in the UI

### Multiple Sessions

- Each card is an independent process
- Only one session visible at a time in the chat panel
- Multiple can run in background (green indicator visible on the board)

## Project Configuration

### First-Time Setup

- ClaudBan detects if `.claudban/config.yaml` exists in the directory
- If not: offers to create one with a default template (6 standard columns + suggested pipelines)
- If exists: loads it directly

### Project Settings Panel (accessible from tab icon)

- Column editor: add, remove, rename, reorder, change color
- Pipeline editor: select transition (from -> to), edit prompt template with syntax highlighting for `{{...}}` variables
- Project path (read-only)

### Global App Settings (`~/.claudban/settings.yaml`)

- Path to `claude` binary (if not in PATH)
- Visual theme (dark by default, possible light)
- Default behavior for new projects (default column template)

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
