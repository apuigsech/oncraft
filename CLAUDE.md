# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## What is OnCraft

OnCraft is a Tauri v2 desktop app that provides a Kanban board interface for managing Claude Code sessions. Each Kanban card maps to a Claude Code conversation. Cards move through a configurable workflow (Flow) with states like Brainstorm → Specify → Plan → Implement → Review → Done. It uses the `@anthropic-ai/claude-agent-sdk` to interact with Claude programmatically.

## Architecture

Three-layer architecture:

```
                     ┌───────────────────────┐
                     │   Tauri Window         │
                     │   (Nuxt/Vue frontend)  │
                     └───────┬───────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
        Tauri IPC      Tauri Shell    Tauri SQL
              │        Plugin              │
              │              │              │
      ┌───────┴───────┐     │      ┌───────┴──────┐
      │ PTY Commands  │     │      │ oncraft.db   │
      │ (pty.rs)      │     │      │ (SQLite)     │
      │ Native Cmds   │     │      └──────────────┘
      │ (commands.rs) │     │
      └───────────────┘     │
                             │
                     ┌───────┴───────┐
                     │ agent-bridge  │
                     │ (Bun sidecar) │
                     └───────┬───────┘
                             │
                     ┌───────┴───────┐
                     │ Claude Agent  │
                     │ SDK           │
                     └───────────────┘
```

1. **Frontend** (`app/`) — Nuxt 4 (SSR disabled) + Vue 3 + Nuxt UI v4 + Pinia stores. Runs as the Tauri webview. No pages/layouts/routing — `app.vue` is the sole entry point.
2. **Tauri backend** (`src-tauri/`) — Rust. Registers Tauri plugins (shell, sql, dialog, fs, opener) and exposes custom commands for PTY management and filesystem operations.
3. **Sidecar** (`src-sidecar/agent-bridge.ts`) — Bun-compiled TypeScript binary. Wraps the Claude Agent SDK. Communicates with the frontend via JSON lines over stdin/stdout. One sidecar per card session, spawned via Tauri's shell plugin.

### Communication flow

- **Frontend → Sidecar**: JSON commands over stdin (`start`, `reply`, `interrupt`, `stop`, `loadHistory`, `listSessions`, `session_response`)
- **Sidecar → Frontend**: JSON messages over stdout (assistant text, tool_use, tool_confirmation, result, system events, etc.)
- **Frontend → Rust**: Tauri IPC invoke for PTY commands (`pty_spawn`, `pty_write`, `pty_resize`, `pty_kill`) and native commands (`list_commands`, `delete_session`, `git_branch_status`)
- **Frontend → SQLite**: Via `@tauri-apps/plugin-sql` for persistence

The frontend's `app/services/claude-process.ts` manages sidecar lifecycle (spawn, write, kill) per card. Messages are parsed by `app/services/stream-parser.ts`.

### Data model

- **Project** — a directory path; cards belong to a project
- **Card** — a Kanban card with a Claude session; has column position, state (`active`/`idle`/`error`/`completed`), optional git worktree, linked files, linked issues, cost metrics
- **Flow** — hierarchical workflow config (preset + project overrides) defining states, agent settings, MCP servers, tools, and prompts
- **FlowState** — per-column config within a Flow (prompt, trigger prompt, required files, agent overrides)
- **SessionConfig** — per-card model/effort/permission/worktree settings

Data persisted in SQLite (`oncraft.db`) via `app/services/database.ts`. Schema migrations use incremental `ALTER TABLE ADD COLUMN` wrapped in try/catch (idempotent).

### Two chat modes

- **Integrated** (`ChatPanel.vue`) — SDK-based chat rendered in Vue with markdown/code highlighting, tool approval UI, image attachments, slash commands
- **Console** (`ConsolePanel.vue`) — xterm.js terminal with a real PTY (via `src-tauri/src/pty.rs`) running Claude CLI directly

## Build & Development Commands

```bash
# Install frontend dependencies
pnpm install

# Run Nuxt dev server (frontend only, no Tauri)
pnpm dev

# Build sidecar binary (must run before Tauri dev/build)
pnpm build:sidecar

# Run the full Tauri desktop app in dev mode
# (automatically runs build:sidecar + pnpm dev via beforeDevCommand)
pnpm tauri dev

# Build production Tauri app
pnpm tauri build

# Build Nuxt for production (generates static output to .output/public)
pnpm build
```

### Sidecar build details

The sidecar is built with Bun and outputs a compiled binary to `src-tauri/binaries/agent-bridge-{target-triple}`. The target triple is auto-detected from `rustc -vV`. To rebuild independently:

```bash
cd src-sidecar
~/.bun/bin/bun install
~/.bun/bin/bun build --compile --target=bun agent-bridge.ts --outfile ../src-tauri/binaries/agent-bridge-$(rustc -vV | sed -n 's/host: //p')
```

## Code Organization

### Frontend (`app/`)

#### Stores (`app/stores/`)

| Store | File | Manages |
|-------|------|---------|
| `useProjectsStore` | `projects.ts` | Projects list, active project, CRUD operations |
| `useCardsStore` | `cards.ts` | Cards per project, column ordering, debounced DB writes (500ms) |
| `useSessionsStore` | `sessions.ts` | Chat messages (ChatPart[]), session configs, metrics, sidecar communication, streaming buffer |
| `useFlowStore` | `flow.ts` | Flow/FlowState config, agent resolution, trigger prompts, required files checking |
| `usePipelinesStore` | `pipelines.ts` | Compatibility shim — proxies to `useFlowStore` |
| `useSettingsStore` | `settings.ts` | Global settings (theme, chat mode), persisted as YAML |

**Store interaction**: `app.vue` mounts → loads `settingsStore` + `projectsStore` → loads `cardsStore` + `flowStore` for active project. `sessionsStore.send()` reads `flowStore.getResolvedConfig()` and updates `cardsStore`.

#### Services (`app/services/`)

| Service | Purpose |
|---------|---------|
| `claude-process.ts` | Sidecar lifecycle: spawn, send, interrupt, kill. Also handles MCP bridge (`session_request`), image temp files, utility sidecar for SDK-dependent operations |
| `chat-part-registry.ts` | Maps sidecar message types → `ChatPartDefinition` (parse function, placement, component, verbosity). 28 registered types. Resolution: `${type}:${toolName}` → `tool:${toolName}` → `${type}` → `_default` |
| `stream-parser.ts` | JSON line parser for sidecar stdout |
| `database.ts` | SQLite layer: `projects` and `cards` tables, migrations, CRUD operations. Converts snake_case DB → camelCase TypeScript |
| `flow-loader.ts` | Loads Flow configs from `.oncraft/` directory and presets. Merges preset → project overrides. Auto-bootstraps with `swe-basic` preset |
| `agent-resolver.ts` | Resolves agent names to `.claude/agents/<name>.md` definitions (YAML frontmatter + markdown body) |
| `template-engine.ts` | Simple `{{ path.to.value }}` template resolver for trigger prompts |
| `markdown.ts` | Lazy-loaded marked + highlight.js (11 languages). `useDebouncedMarkdown()` composable for streaming (80ms debounce) |
| `session-history.ts` | Legacy history loader from Claude Code's JSONL files |

#### Composables (`app/composables/`)

| Composable | Purpose |
|------------|---------|
| `useChatParts` | Filters ChatPart[] into placement zones (header, inline, action-bar, progress). Handles verbosity filtering |
| `useUIMessages` | Transforms ChatPart[] into UIMessage[] for Nuxt UI's `UChatMessages` component. Groups consecutive assistant/tool parts |
| `useFileViewer` | Global state for the file viewer overlay |

#### Components (`app/components/`)

31 components in a flat directory (no nesting). Key groups:

- **App shell**: `TabBar`, `ProjectSettings`, `GlobalSettings`
- **Kanban**: `KanbanBoard`, `KanbanColumn`, `KanbanCard`, `CardContextMenu`, `StatusIndicator`, `NewSessionDialog`, `EditCardDialog`, `ImportSessionsDialog`, `FileViewer`
- **Chat (integrated mode)**: `ChatPanel`, `MarkdownContent`, `ToolCallBlock`, `ToolApprovalBar`, `UserQuestionBar`, `UserMessageBlock`, `PromptSuggestionBar`, `AgentProgressBar`, `InputToolbar`, `SlashCommandPalette`, `ImageAttachmentBar`, `ContextGauge`, `SessionMetrics`, `TaskListDisplay`, `ErrorNotice`, `RateLimitNotice`, `HookActivityBlock`, `GenericMessageBlock`
- **Console mode**: `ConsolePanel`

#### Types (`app/types/`)

- `index.ts` — All core interfaces: `Project`, `Card`, `CardState`, `Flow`, `FlowState`, `FlowWarning`, `SessionConfig`, `StreamMessage`, `PermissionMode`, `EffortLevel`, `ModelAlias`, `TemplateContext`, `ImageAttachment`, `GlobalSettings`, etc.
- `chat-part.ts` — Chat rendering types: `ChatPart`, `ChatPartDefinition`, `Placement`, `VerbosityLevel`, `SidecarMessage`

### Tauri Backend (`src-tauri/`)

| File | Purpose |
|------|---------|
| `src/lib.rs` | App builder: registers 5 Tauri plugins (opener, shell, sql, dialog, fs) + PtyManager state + 7 custom commands |
| `src/main.rs` | Entry point. Calls `fix_path_env::fix()` for macOS PATH repair, then `run()` |
| `src/pty.rs` | PTY management: `pty_spawn` (with 60Hz output throttling), `pty_write`, `pty_resize`, `pty_kill`. Uses `portable-pty` crate |
| `src/commands.rs` | Native filesystem commands: `list_commands` (scans ~/.claude/ + project for slash commands/skills), `git_branch_status` (ahead/behind), `delete_session` |
| `tauri.conf.json` | App config: product name "OnCraft", sidecar as external binary, presets bundled as resources, CSP disabled |
| `capabilities/default.json` | Security permissions: shell spawn limited to agent-bridge sidecar, fs scoped to $HOME/$APPCONFIG/$APPDATA |

### Sidecar (`src-sidecar/`)

Single file: `agent-bridge.ts`. Key design:

- **Persistent session model**: `MessageStream` implements `AsyncIterator<SDKUserMessage>`. The SDK's `query()` consumes it via `for await`. New user messages are enqueued without creating new SDK sessions.
- **MCP bridge**: Exposes 3 tools to Claude via an "oncraft" MCP server: `get_current_card`, `update_current_card`, `get_project`. These send `session_request` messages to the frontend.
- **Tool approval**: Uses promise-based blocking. Emits `tool_confirmation`, waits for `reply` command from frontend.
- **Dependencies**: `@anthropic-ai/claude-agent-sdk` ^0.2.76, `zod` ^4.0.0

### Flow System (`presets/` and `.oncraft/`)

Flows define the card workflow. Config is hierarchical: **Preset → Flow → FlowState**, with project overrides.

**File structure**:
```
.oncraft/
  flow.yaml          # preset: swe-basic (or inline config)
  flow.md            # global system prompt append
  states/
    <slug>/
      state.yaml     # state config (name, color, icon, agent overrides)
      prompt.md      # system prompt for this state
      trigger.md     # auto-fire prompt on card entry (uses {{ template }} vars)

presets/
  swe-basic/
    flow.yaml        # name, agent defaults, stateOrder
    flow.md          # global system prompt
    states/          # same structure per state
```

**Bundled preset `swe-basic`**: 6 states (Brainstorm → Specify → Plan → Implement → Review → Done). Each state has specific agent instructions, and some require linked files (e.g., Plan requires `spec`, Review requires `spec` + `plan`).

**Template variables** in trigger.md: `{{ session.name }}`, `{{ card.description }}`, `{{ card.linkedFiles.spec }}`, `{{ column.from }}`, `{{ column.to }}`

## Key Conventions

### Package managers
- **pnpm** for the frontend (root `package.json`)
- **bun** for the sidecar (`src-sidecar/`)

### Nuxt / Vue
- **Nuxt auto-imports enabled** — stores, composables, components, and Vue APIs (`ref`, `computed`, `watch`, `onMounted`) don't need explicit imports
- **SSR disabled** (`ssr: false`) — runs in a Tauri webview, not a server
- **No pages/layouts/routing** — `app.vue` is the sole entry point; all UI is component-based
- **Dark mode default** (`colorMode.preference: 'dark'`)
- Vite ignores `src-tauri/` for file watching

### State management patterns
- **Debounced DB writes**: Card state changes update in-memory immediately but debounce SQLite writes (500ms) to reduce IPC overhead. See `_debouncedDbWrite` in `cards.ts`.
- **Streaming token buffering**: Tokens buffered in a plain Map and flushed via `requestAnimationFrame` to avoid per-token reactive mutations. See `_streamingBuffers` in `sessions.ts`.
- **Memory cap**: Max 500 messages per card in memory. `purgeCard()` cleans all in-memory data on archive/remove.

### ChatPart registry pattern
All sidecar messages flow through `chat-part-registry.ts` which determines for each message type:
- `parse`: how to extract data from the raw message
- `placement`: where in the UI it appears (header/inline/action-bar/progress/hidden)
- `component`: which Vue component renders it
- `verbosity`: at what level it becomes visible (quiet/normal/verbose)

When adding new message types, register them in `chat-part-registry.ts` and create the corresponding component.

### Lazy loading
Heavy dependencies are loaded on demand:
- `ChatPanel`, `ConsolePanel`, settings dialogs: `defineAsyncComponent`
- Markdown engine (marked + highlight.js ~480KB): loaded on first chat open
- xterm.js (~300KB): loaded when console mode is selected
- Vite manual chunks split highlight.js, marked, xterm, Tauri plugins, and Nuxt UI

### Database migrations
Incremental `ALTER TABLE ADD COLUMN` statements wrapped in try/catch. The catch silently ignores "column already exists" errors, making migrations idempotent. Add new columns at the bottom of the migration block in `database.ts`.

### Sidecar protocol
JSON lines (one JSON object per line) over stdin/stdout. Key conventions:
- Commands to sidecar have a `cmd` field: `start`, `reply`, `interrupt`, `stop`, `loadHistory`, `listSessions`, `session_response`
- Messages from sidecar have a `type` field: `assistant`, `tool_use`, `tool_confirmation`, `result`, `system`, `error`, etc.
- The `start` command both creates new sessions and enqueues messages into existing ones (persistent session model)

### CSS theming
Custom properties defined in `assets/theme.css` and `assets/main.css`: `--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--border`, `--accent`, `--text-primary`, `--text-secondary`, `--text-muted`, `--success`, `--error`, `--warning`. Tokyo Night color scheme for code highlighting.

### Rust conventions
- PTY output throttled at ~60Hz (16ms flush intervals, 8KB buffer cap) to prevent overwhelming the WebView
- `fix-path-env` crate fixes macOS PATH for GUI apps launched via launchd
- Commands use `tauri::command` attribute macro, state accessed via `tauri::State<T>`

## Common Tasks

### Adding a new sidecar message type
1. Add the message type handling in `src-sidecar/agent-bridge.ts` `translateMessage()` function
2. Register the type in `app/services/chat-part-registry.ts` with parse function, placement, component name, and verbosity
3. Create the Vue component in `app/components/` if needed
4. The component will be auto-imported by Nuxt

### Adding a new database column to cards
1. Add the column to the `Card` interface in `app/types/index.ts`
2. Add the `ALTER TABLE` migration in `app/services/database.ts` `initDb()` (inside try/catch)
3. Update `getCardsByProject()` SELECT query and row mapping
4. Update `insertCard()` and `updateCard()` as needed
5. Update `useCardsStore` in `app/stores/cards.ts` to expose the new field

### Adding a new Tauri command
1. Define the `#[tauri::command]` function in `src-tauri/src/commands.rs` (or `pty.rs` for PTY-related)
2. Register it in `.invoke_handler(tauri::generate_handler![...])` in `src-tauri/src/lib.rs`
3. Call from frontend via `invoke('command_name', { args })` from `@tauri-apps/api/core`

### Adding a new Flow state to a preset
1. Create `presets/<preset>/states/<StateName>/state.yaml` with name, color, icon
2. Create `prompt.md` with system prompt instructions
3. Optionally create `trigger.md` with auto-fire prompt using `{{ template }}` variables
4. Add the state name to `stateOrder` in the preset's `flow.yaml`

### Adding a new MCP tool for Claude to use
1. Define the tool in `src-sidecar/agent-bridge.ts` using the `tool()` function from the SDK
2. Add it to the `oncraftMcpServer` tools array
3. If it needs frontend data, use the `requestFromFrontend()` pattern and handle the request in `handleSessionRequest()` in `app/services/claude-process.ts`

## Files to Never Edit Manually

- `pnpm-lock.yaml` — generated by pnpm
- `src-sidecar/bun.lock` — generated by bun
- `.nuxt/` — generated by Nuxt
- `.output/` — generated by Nuxt build
- `src-tauri/target/` — generated by Cargo
- `src-tauri/binaries/` — compiled sidecar binaries (regenerated by `build:sidecar`)
- `src-tauri/gen/` — auto-generated Tauri schemas
- `oncraft.db` — runtime SQLite database
