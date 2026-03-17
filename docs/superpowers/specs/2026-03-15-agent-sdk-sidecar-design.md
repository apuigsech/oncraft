# Agent SDK Sidecar Migration Design

**Date**: 2026-03-15
**Status**: Approved
**Scope**: Infrastructure only (backend replacement, minimal frontend changes)

## Problem

OnCraft currently invokes the `claude` CLI via Tauri's shell plugin using `execute()`, which:
- Blocks until the entire response completes (no streaming)
- Cannot handle tool approval callbacks (ToolCallBlock buttons are non-functional)
- Only receives the final `result` blob from `execute()` — the stream-parser handles multiple types but `execute()` never delivers intermediate messages to it
- Cannot kill a running process

## Solution

Replace the direct CLI invocation with a **Node.js sidecar binary** that uses `@anthropic-ai/claude-code-sdk`. The sidecar is compiled with `bun build --compile` into a standalone binary, registered as a Tauri sidecar, and included in the application bundle.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Tauri App                                                │
│                                                           │
│  ┌──────────────┐    Tauri IPC      ┌──────────────────┐ │
│  │  Vue Frontend │ ◄───────────────► │  Rust Backend    │ │
│  │  (ChatPanel,  │   (events +      │  (spawn/kill     │ │
│  │   sessions    │    invoke)       │   sidecar)       │ │
│  │   store)      │                  └────────┬─────────┘ │
│  └──────────────┘                            │           │
│                                     stdin/stdout JSON-lines│
│                                              │           │
│                               ┌──────────────▼─────────┐ │
│                               │  agent-bridge sidecar  │ │
│                               │  (Bun-compiled binary) │ │
│                               │                        │ │
│                               │  @anthropic-ai/        │ │
│                               │  claude-code-sdk       │ │
│                               └────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

- 1 card = 1 sidecar process
- Tauri spawns the sidecar via `Command.sidecar("agent-bridge")`
- Communication is JSON-lines over stdin/stdout
- The sidecar manages one Claude SDK session per process

### Sidecar Lifecycle

The sidecar process lifecycle is tied to a chat interaction:
1. **Spawn**: when the user sends the first message to a card (or reopens a card for chat)
2. **Active**: handles one `start` command, iterates the SDK conversation, emits messages
3. **Idle after query**: after the `result` message, the sidecar stays alive waiting for the next `start` command (new turn in the same session)
4. **Kill**: when the user closes the chat panel, stops the session, or the app closes — the frontend sends `stop` or kills the process directly
5. **Crash recovery**: if the sidecar process exits unexpectedly (Tauri emits a `close` event), the frontend sets the card state to `idle` and the user can re-send to spawn a new sidecar

Tool approvals are strictly sequential — the SDK calls `canUseTool` one at a time, so only one `tool_confirmation` is pending at any given moment. The `reply` command always resolves the single outstanding confirmation.

## Sidecar Protocol

### Frontend to Sidecar (stdin)

```jsonl
{"cmd":"start","prompt":"fix the bug","projectPath":"/path/to/project","sessionId":"abc-123"}
{"cmd":"reply","content":"allow"}
{"cmd":"reply","content":"deny"}
{"cmd":"interrupt"}
{"cmd":"stop"}
```

| Command | Purpose |
|---------|---------|
| `start` | Begin a new query. `sessionId` is optional (omit for new session, include to resume). |
| `reply` | Respond to a `tool_confirmation` message. Values: `"allow"` or `"deny"`. |
| `interrupt` | Cancel the current generation via AbortController. |
| `stop` | Gracefully terminate the sidecar process. |

### Sidecar to Frontend (stdout)

```jsonl
{"type":"system","subtype":"init","sessionId":"new-session-id"}
{"type":"assistant","content":"I'll fix that bug...","usage":{"inputTokens":100,"outputTokens":50}}
{"type":"tool_use","toolName":"Read","toolInput":{"file_path":"/src/main.ts"},"toolUseId":"tu_123"}
{"type":"tool_confirmation","toolName":"Bash","toolInput":{"command":"npm test"},"toolUseId":"tu_456"}
{"type":"tool_result","toolUseId":"tu_123","content":"file contents..."}
{"type":"result","sessionId":"abc-123","costUsd":0.05,"durationMs":12000}
{"type":"error","message":"Rate limited","retryAfter":30}
```

| Type | When emitted |
|------|-------------|
| `system` (subtype `init`) | Session initialized, contains `sessionId` |
| `assistant` | Claude's text response (or partial, when streaming is added later) |
| `tool_use` | Claude wants to use a tool (informational, auto-approved) |
| `tool_confirmation` | Claude wants to use a tool that requires user approval. **Blocks** until `reply` received. |
| `tool_result` | Result of a tool execution. `toolUseId` links to the originating `tool_use`. |
| `result` | Query completed. Contains session metadata, cost, duration. |
| `error` | Error occurred (rate limit, auth, etc.) |

## Sidecar Implementation

### File structure

```
src-sidecar/
  agent-bridge.ts       # Entry point
  package.json          # Depends on @anthropic-ai/claude-code-sdk
  tsconfig.json
src-tauri/
  binaries/
    agent-bridge-aarch64-apple-darwin   # Compiled by bun (macOS ARM)
    agent-bridge-x86_64-apple-darwin    # Compiled by bun (macOS Intel)
```

### Core logic (agent-bridge.ts)

The sidecar:
1. Reads JSON-lines from stdin
2. On `start` command: calls `query()` from the SDK with `canUseTool` callback
3. The `canUseTool` callback emits `tool_confirmation` to stdout and blocks on a Promise until a `reply` arrives on stdin
4. For each SDK message, translates and emits to stdout
5. On `interrupt`: calls `abort()` on the AbortController
6. On `stop`: calls `process.exit(0)`

Key detail: the `canUseTool` callback is the mechanism that enables real tool approval. It receives `(toolName, input)` and must return `{ behavior: "allow" }` or `{ behavior: "deny", message }`. The sidecar bridges this to the JSON-lines protocol.

**Deadlock prevention**: The stdin reader runs as an independent `readline` async listener on the Node/Bun event loop. The `canUseTool` callback creates a new Promise and stores its `resolve` function. The readline `on('line')` handler checks for `reply` commands and resolves the pending Promise. Since both are async and non-blocking, the event loop processes stdin lines while the SDK awaits the Promise — no deadlock possible.

### Build

```bash
cd src-sidecar && bun build --compile --target=bun agent-bridge.ts \
  --outfile ../src-tauri/binaries/agent-bridge-aarch64-apple-darwin
```

Integrated into the build pipeline via `tauri.conf.json` `beforeBuildCommand`.

## Frontend Changes

### claude-process.ts (rewrite)

Replace blocking `executeClaudeTurn()` with event-driven API:

```typescript
spawnSession(cardId, projectPath, prompt, sessionId?): void
sendReply(cardId, content: "allow" | "deny"): void
interrupt(cardId): void
killProcess(cardId): void
isProcessActive(cardId): boolean
onMessage(cardId, callback: (msg: StreamMessage) => void): void
```

- Uses `Command.sidecar("agent-bridge").spawn()` instead of `Command.create("claude").execute()`
- Listens to stdout events, parses JSON-lines, dispatches to callbacks
- Tracks one sidecar process per card

### stream-parser.ts (update)

Full rewrite of `parseStreamLine()` for the sidecar's simpler flat-JSON protocol. The current parser handles deep nesting (`data.message.content[].text`) from the raw CLI output; the sidecar normalizes this to flat fields (`data.content`), so the parser becomes significantly simpler.

### types/index.ts (extend)

```typescript
export interface StreamMessage {
  type: 'assistant' | 'user' | 'tool_use' | 'tool_result' | 'system' | 'tool_confirmation';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  toolUseId?: string;      // NEW: links tool_use to tool_result
  subtype?: string;        // NEW: 'init', 'result', 'error', 'thinking', etc.
  sessionId?: string;
  timestamp: number;
  usage?: { inputTokens: number; outputTokens: number };  // NEW
  costUsd?: number;        // NEW
  durationMs?: number;     // NEW: from result messages
  retryAfter?: number;     // NEW: from error messages (rate limit)
}
```

Note: The sidecar's `result` and `error` message types are mapped to `StreamMessage.type = 'system'` with `subtype = 'result'` or `subtype = 'error'` respectively, keeping the union type small.

### sessions store (significant rewrite)

Before: `send()` calls `await executeClaudeTurn()` (blocking), manages "thinking" indicator, pushes single result.
After: Decomposed into distinct methods:
- `send(cardId, message)` — for user chat messages: spawns sidecar via `spawnSession()`, sets card state to `active`, registers `onMessage` callback
- `approveToolUse(cardId)` — calls `sendReply(cardId, 'allow')` on the sidecar
- `rejectToolUse(cardId)` — calls `sendReply(cardId, 'deny')` on the sidecar
- `interruptSession(cardId)` — calls `interrupt(cardId)` on the sidecar
- `stopSession(cardId)` — kills sidecar, cleans up listeners

The `onMessage` callback handles state transitions reactively:
- On `system` with `subtype: 'init'` → capture `sessionId` on card
- On `system` with `subtype: 'result'` → set card state to `idle`
- On `system` with `subtype: 'error'` → set card state to `error`
- On sidecar process close (Tauri `close` event) → set card state to `idle`, clean up

Removed: `claudeAvailable`, `claudeError`, `verifyClaudeBinary()` — no longer needed since sidecar is bundled.

### ToolCallBlock.vue (minor change)

`approve()` / `reject()` currently call `sessionsStore.send(cardId, 'y'/'n')`, which sends a regular chat message. Updated to call new dedicated methods: `sessionsStore.approveToolUse(cardId)` and `sessionsStore.rejectToolUse(cardId)`, which route to `sendReply()` on the sidecar. The template stays the same.

### ChatPanel.vue (minimal change)

Stops awaiting a single response. Messages appear reactively via Vue reactivity as the store receives them from the sidecar callback.

### Capabilities (default.json)

Replace all `claude` / `claude-homebrew` / `claude-usr-local` scope names with sidecar entries. Both `shell:allow-spawn` (for `Command.sidecar().spawn()`) and `shell:allow-execute` are needed:

```json
{
  "identifier": "shell:allow-spawn",
  "allow": [{ "name": "binaries/agent-bridge", "sidecar": true }]
},
{
  "identifier": "shell:allow-execute",
  "allow": [{ "name": "binaries/agent-bridge", "sidecar": true }]
}
```

Keep `shell:allow-stdin-write` and `shell:allow-kill`.

## Build Pipeline Changes

### tauri.conf.json

```json
{
  "build": {
    "beforeBuildCommand": "pnpm build && pnpm build:sidecar",
    "beforeDevCommand": "pnpm build:sidecar && pnpm dev"
  }
}
```

### package.json (new scripts)

```json
{
  "scripts": {
    "build:sidecar": "cd src-sidecar && bun install && bun build --compile --target=bun agent-bridge.ts --outfile ../src-tauri/binaries/agent-bridge-$(rustc -vV | sed -n 's/host: //p')"
  }
}
```

### Tauri sidecar registration

In `tauri.conf.json`:
```json
{
  "bundle": {
    "externalBin": ["binaries/agent-bridge"]
  }
}
```

Tauri automatically appends the target triple suffix and includes the binary in the bundle.

## What This Unlocks

| Capability | Before | After |
|-----------|--------|-------|
| Streaming | None (blocking execute) | Real streaming via SDK message iteration |
| Tool approval | Non-functional buttons | Working approve/deny via `canUseTool` callback |
| Message types | Only `result` | All SDK types: assistant, tool_use, tool_result, system, etc. |
| Kill process | No-op | Real process kill via sidecar termination |
| Session resume | Via `--resume` flag | Via SDK `resume` option |
| Cost tracking | Not available | From `result` message `costUsd` field |
| Token usage | Not available | From `assistant` message `usage` field |

## What This Does NOT Change

- Kanban board UI, card management, column/pipeline logic
- Database schema or storage
- Project settings (note: `claudeBinaryPath` from GlobalSettings is removed as it becomes unnecessary)
- Template engine
- Vue components other than minor wiring changes in ChatPanel, ToolCallBlock, and sessions store
- Target platform: macOS only for v0.1 (Linux/Windows sidecar binaries are future work)

## Future Work (out of scope)

- Incremental streaming text rendering (Phase 1 UI)
- Thinking block display
- Context window visualization
- File diff rendering
- Slash command autocomplete
- Permission mode switching UI
