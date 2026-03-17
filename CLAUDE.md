# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is OnCraft

OnCraft is a Tauri v2 desktop app that provides a Kanban board interface for managing Claude Code sessions. Each Kanban card maps to a Claude Code conversation. It uses the `@anthropic-ai/claude-agent-sdk` to interact with Claude programmatically.

## Architecture

Three-layer architecture:

1. **Frontend** (`app/`) — Nuxt 4 (SSR disabled) + Vue 3 + Nuxt UI v4 + Pinia stores. Runs as the Tauri webview.
2. **Tauri backend** (`src-tauri/`) — Rust. Registers Tauri plugins (shell, sql, dialog, fs, opener) and custom PTY commands for the console mode terminal.
3. **Sidecar** (`src-sidecar/agent-bridge.ts`) — Bun-compiled TypeScript binary. Wraps the Claude Agent SDK. Communicates with the frontend via JSON-over-stdin/stdout. The sidecar is spawned per card session via Tauri's shell plugin.

### Communication flow

```
Frontend (Vue) → Tauri shell plugin → agent-bridge sidecar (Bun binary)
                                        ↕ Claude Agent SDK
                                        ↕ JSON lines over stdin/stdout
```

The frontend's `app/services/claude-process.ts` manages sidecar lifecycle (spawn, write, kill) per card. Messages flow as JSON lines parsed by `app/services/stream-parser.ts`.

### Key data model

- **Project** — a directory path; cards belong to a project
- **Card** — a Kanban card with a Claude session; has column position, state (active/idle/error/completed), optional worktree
- **Pipeline** — automation rules for moving cards between columns with prompts
- **SessionConfig** — per-card model/effort/permission settings

Data is persisted in SQLite via `@tauri-apps/plugin-sql` (file: `oncraft.db`). Schema migrations run on startup in `app/services/database.ts`.

### Two chat modes

- **Integrated** (`ChatPanel.vue`) — SDK-based chat rendered in Vue with markdown/code highlighting
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

The sidecar is built with Bun and outputs a compiled binary to `src-tauri/binaries/agent-bridge-{target-triple}`. The target triple is auto-detected from `rustc -vV`. To rebuild the sidecar independently:

```bash
cd src-sidecar
~/.bun/bin/bun install
~/.bun/bin/bun build --compile --target=bun agent-bridge.ts --outfile ../src-tauri/binaries/agent-bridge-$(rustc -vV | sed -n 's/host: //p')
```

## Code Organization

- `app/stores/` — Pinia stores: `sessions.ts` (chat state, message handling), `cards.ts`, `projects.ts`, `pipelines.ts`, `settings.ts`
- `app/services/` — Core services: `claude-process.ts` (sidecar management), `stream-parser.ts` (JSON line parsing), `database.ts` (SQLite), `message-adapter.ts`, `session-history.ts`, `markdown.ts`, `config-loader.ts`, `template-engine.ts`
- `app/components/` — Vue components (flat directory, no nesting)
- `app/types/index.ts` — All TypeScript interfaces and types
- `src-tauri/src/pty.rs` — PTY management for console mode (spawn, write, resize, kill)
- `src-tauri/src/lib.rs` — Tauri plugin registration and command handlers

## Key Conventions

- Package manager is **pnpm** for the frontend, **bun** for the sidecar (`src-sidecar/`)
- Nuxt auto-imports are enabled — stores, composables, and components don't need explicit imports
- SSR is disabled (`ssr: false` in nuxt.config.ts) since this runs in a Tauri webview
- The sidecar protocol is JSON lines: one JSON object per line on stdin/stdout
- Database migrations are incremental ALTER TABLE statements wrapped in try/catch (column-already-exists pattern)
- Dark mode is the default (`colorMode.preference: 'dark'`)
- Vite is configured to ignore `src-tauri/` for file watching
