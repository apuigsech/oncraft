# Agent SDK Sidecar Migration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blocking `claude` CLI invocation with a Node.js sidecar binary that uses `@anthropic-ai/claude-code-sdk`, enabling real streaming, tool approval callbacks, and all message types.

**Architecture:** A standalone Bun-compiled binary (`agent-bridge`) communicates with Tauri via stdin/stdout JSON-lines. Each kanban card spawns one sidecar process. The frontend switches from `execute()` (blocking) to `spawn()` (event-driven) with message callbacks.

**Tech Stack:** TypeScript, Bun, `@anthropic-ai/claude-code-sdk`, Tauri v2 shell plugin, Vue 3 + Pinia

**Spec:** `docs/superpowers/specs/2026-03-15-agent-sdk-sidecar-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `src-sidecar/package.json` | Sidecar dependencies (`@anthropic-ai/claude-code-sdk`) |
| Create | `src-sidecar/tsconfig.json` | TypeScript config for sidecar |
| Create | `src-sidecar/agent-bridge.ts` | Sidecar entry point: stdin/stdout JSON-lines bridge to SDK |
| Modify | `src/types/index.ts` | Add `toolUseId`, `usage`, `costUsd` fields to `StreamMessage` |
| Rewrite | `src/services/claude-process.ts` | Replace `execute()` with `spawn()` sidecar API |
| Rewrite | `src/services/stream-parser.ts` | Adapt parser to sidecar protocol |
| Modify | `src/stores/sessions.ts` | Switch from blocking `send()` to event-driven `spawnSession()` |
| Modify | `src/components/ChatPanel.vue` | Remove `await` on send, non-blocking flow |
| Modify | `src/components/ToolCallBlock.vue` | Map approve/reject to `"allow"`/`"deny"` |
| Rewrite | `src-tauri/capabilities/default.json` | Replace `claude` scope names with sidecar entry |
| Modify | `src-tauri/tauri.conf.json` | Add `externalBin`, update build commands |
| Modify | `package.json` | Add `build:sidecar` script |

---

## Chunk 1: Sidecar Binary

### Task 1: Scaffold sidecar project

**Files:**
- Create: `src-sidecar/package.json`
- Create: `src-sidecar/tsconfig.json`

- [ ] **Step 1: Create `src-sidecar/package.json`**

```json
{
  "name": "claudban-agent-bridge",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@anthropic-ai/claude-code-sdk": "^0.1.0"
  },
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

- [ ] **Step 2: Create `src-sidecar/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "declaration": false,
    "types": ["@types/bun"]
  },
  "include": ["*.ts"]
}
```

- [ ] **Step 3: Install dependencies**

Run: `cd src-sidecar && bun install`
Expected: `node_modules/` created with `@anthropic-ai/claude-code-sdk`

- [ ] **Step 4: Commit**

```bash
git add src-sidecar/package.json src-sidecar/tsconfig.json src-sidecar/bun.lockb
git commit -m "feat: scaffold sidecar project with claude-code-sdk dependency"
```

---

### Task 2: Implement `agent-bridge.ts`

**Files:**
- Create: `src-sidecar/agent-bridge.ts`

- [ ] **Step 1: Create `agent-bridge.ts` with stdin/stdout JSON-lines protocol**

The sidecar reads commands from stdin and emits messages to stdout. Key behaviors:
- `start` command → calls `query()` from SDK, iterates messages, emits translated JSON-lines
- `reply` command → resolves pending `canUseTool` Promise
- `interrupt` command → aborts current query via AbortController
- `stop` command → exits process

```typescript
import { query, type Message } from "@anthropic-ai/claude-code-sdk";
import { createInterface } from "readline";

// ---- stdout helpers ----
function emit(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function emitError(message: string, details?: Record<string, unknown>): void {
  emit({ type: "error", message, ...details });
}

// ---- state ----
let pendingApproval: ((answer: string) => void) | null = null;
let currentAbort: AbortController | null = null;

// ---- message translation ----
// Returns a single message object, an array of message objects (for multi-block
// assistant messages), or null if the message should be skipped.
function translateMessage(
  msg: Message,
): Record<string, unknown> | Record<string, unknown>[] | null {
  if (msg.type === "assistant") {
    const content = msg.message?.content;
    if (!content || !Array.isArray(content)) return null;

    // Emit each content block separately
    const results: Record<string, unknown>[] = [];
    for (const block of content) {
      if (block.type === "text") {
        results.push({
          type: "assistant",
          content: block.text,
          usage: msg.message?.usage
            ? {
                inputTokens: msg.message.usage.input_tokens,
                outputTokens: msg.message.usage.output_tokens,
              }
            : undefined,
        });
      } else if (block.type === "tool_use") {
        results.push({
          type: "tool_use",
          toolName: block.name,
          toolInput: block.input,
          toolUseId: block.id,
        });
      } else if (block.type === "thinking") {
        results.push({
          type: "assistant",
          content: block.thinking,
          subtype: "thinking",
        });
      }
    }
    if (results.length === 0) return null;
    return results.length === 1 ? results[0] : results;
  }

  if (msg.type === "user") {
    const content = msg.message?.content;
    if (!content || !Array.isArray(content)) return null;

    for (const block of content) {
      if (block.type === "tool_result") {
        return {
          type: "tool_result",
          toolUseId: block.tool_use_id,
          content:
            typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content),
        };
      }
    }
    return null;
  }

  if (msg.type === "result") {
    return {
      type: "result",
      sessionId: msg.session_id,
      costUsd: msg.total_cost_usd,
      durationMs: msg.duration_ms,
      usage: msg.usage
        ? {
            inputTokens: msg.usage.input_tokens,
            outputTokens: msg.usage.output_tokens,
          }
        : undefined,
    };
  }

  if (msg.type === "system") {
    if (msg.subtype === "init") {
      return {
        type: "system",
        subtype: "init",
        sessionId: msg.session_id,
      };
    }
    return {
      type: "system",
      subtype: msg.subtype || "unknown",
      content: msg.message || msg.subtype || "",
    };
  }

  // Pass through unknown types as system messages
  return {
    type: "system",
    subtype: (msg as Record<string, unknown>).type as string,
    content: JSON.stringify(msg),
  };
}

// ---- main loop ----
const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", async (line: string) => {
  let cmd: Record<string, unknown>;
  try {
    cmd = JSON.parse(line);
  } catch {
    emitError("Invalid JSON on stdin");
    return;
  }

  // Handle reply to pending tool approval
  if (cmd.cmd === "reply" && pendingApproval) {
    pendingApproval(cmd.content as string);
    pendingApproval = null;
    return;
  }

  // Handle interrupt
  if (cmd.cmd === "interrupt") {
    if (currentAbort) {
      currentAbort.abort();
    }
    return;
  }

  // Handle stop
  if (cmd.cmd === "stop") {
    process.exit(0);
  }

  // Handle start
  if (cmd.cmd === "start") {
    currentAbort = new AbortController();

    try {
      const conversation = query({
        prompt: cmd.prompt as string,
        options: {
          cwd: cmd.projectPath as string,
          resume: cmd.sessionId ? (cmd.sessionId as string) : undefined,
          abortController: currentAbort,
          permissionMode: "default",
          canUseTool: async (toolName: string, input: Record<string, unknown>) => {
            // Emit tool_confirmation to stdout and block until reply arrives
            emit({
              type: "tool_confirmation",
              toolName,
              toolInput: input,
            });
            // Wait for the reply command from stdin
            const answer = await new Promise<string>((resolve) => {
              pendingApproval = resolve;
            });
            return answer === "allow"
              ? { behavior: "allow" as const }
              : { behavior: "deny" as const, message: "User denied" };
          },
        },
      });

      for await (const message of conversation) {
        const translated = translateMessage(message);
        if (translated) {
          // Handle multiple blocks from a single assistant message
          if (Array.isArray(translated)) {
            for (const t of translated) emit(t);
          } else {
            emit(translated);
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") {
        emit({ type: "system", subtype: "interrupted", content: "Query interrupted" });
      } else {
        emitError(String(err));
      }
    } finally {
      currentAbort = null;
    }
    return;
  }

  emitError(`Unknown command: ${cmd.cmd}`);
});

// Handle stdin close (Tauri killed us)
rl.on("close", () => {
  process.exit(0);
});
```

Note: The `canUseTool` callback uses the documented SDK pattern. The readline listener and the `pendingApproval` Promise operate on the same Bun/Node event loop — the readline handler resolves the Promise while the SDK's `canUseTool` awaits it, preventing any deadlock. If the SDK's actual API surface differs from docs (e.g., different callback signature or message-based permission protocol), this code will need adaptation during Task 12 E2E verification.

- [ ] **Step 2: Verify the sidecar compiles with bun**

Run: `cd src-sidecar && bun build --compile --target=bun agent-bridge.ts --outfile ../src-tauri/binaries/agent-bridge-$(rustc -vV | sed -n 's/host: //p')`
Expected: Binary created at `src-tauri/binaries/agent-bridge-aarch64-apple-darwin` (or equivalent target triple)

- [ ] **Step 3: Smoke test the sidecar manually**

Run: `echo '{"cmd":"stop"}' | ./src-tauri/binaries/agent-bridge-aarch64-apple-darwin`
Expected: Process exits cleanly with code 0

- [ ] **Step 4: Add `src-tauri/binaries/` to `.gitignore`**

Append to `.gitignore`:
```
src-tauri/binaries/
```

The binaries are build artifacts — not committed to git.

- [ ] **Step 5: Commit**

```bash
git add src-sidecar/agent-bridge.ts .gitignore
git commit -m "feat: implement agent-bridge sidecar with SDK integration"
```

---

### Task 3: Build pipeline integration

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Add `build:sidecar` script to root `package.json`**

Add to the `"scripts"` section:

```json
"build:sidecar": "cd src-sidecar && bun install && bun build --compile --target=bun agent-bridge.ts --outfile ../src-tauri/binaries/agent-bridge-$(rustc -vV | sed -n 's/host: //p')"
```

- [ ] **Step 2: Update `tauri.conf.json` — add `externalBin` and update build commands**

Add `externalBin` inside `bundle`:
```json
"bundle": {
  "externalBin": ["binaries/agent-bridge"],
  ...
}
```

Update `build` section:
```json
"build": {
  "beforeDevCommand": "pnpm build:sidecar && pnpm dev",
  "beforeBuildCommand": "pnpm build && pnpm build:sidecar",
  ...
}
```

Note: `beforeDevCommand` runs `build:sidecar` first (synchronous), then `pnpm dev` (Vite dev server, which Tauri monitors via `devUrl`). `beforeBuildCommand` runs the frontend build first for type-checking, then the sidecar build.

- [ ] **Step 3: Verify full build works**

Run: `cd src-tauri && cargo build`
Expected: Build succeeds. Tauri detects the sidecar binary in `binaries/`.

- [ ] **Step 4: Commit**

```bash
git add package.json src-tauri/tauri.conf.json
git commit -m "feat: integrate sidecar build into Tauri pipeline"
```

---

## Chunk 2: Frontend Integration

> **Important:** Tasks 4-11 form an atomic unit. The app will not compile between individual tasks in this chunk because imports and APIs change simultaneously. Do not attempt to build or test until all tasks in Chunks 2 and 3 are complete. Task 12 is the first point where the app should compile and run.

### Task 4: Extend `StreamMessage` type

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add new optional fields to `StreamMessage`**

Add `toolUseId`, `usage`, `costUsd`, `subtype`, `durationMs`, `retryAfter` fields:

```typescript
export interface StreamMessage {
  type: 'assistant' | 'user' | 'tool_use' | 'tool_result' | 'system' | 'tool_confirmation';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  toolUseId?: string;
  subtype?: string;
  sessionId?: string;
  timestamp: number;
  usage?: { inputTokens: number; outputTokens: number };
  costUsd?: number;
  durationMs?: number;
  retryAfter?: number;
}
```

This is backward-compatible — all new fields are optional.

- [ ] **Step 2: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: extend StreamMessage type with SDK fields"
```

---

### Task 5: Rewrite `stream-parser.ts`

**Files:**
- Rewrite: `src/services/stream-parser.ts`

- [ ] **Step 1: Rewrite parser for the sidecar protocol**

The sidecar emits a cleaner, normalized protocol. The parser becomes simpler:

```typescript
import type { StreamMessage } from '../types';

export function parseStreamLine(line: string): StreamMessage | null {
  if (!line.trim()) return null;

  try {
    const data = JSON.parse(line);

    if (data.type === 'assistant') {
      return {
        type: 'assistant',
        content: data.content || '',
        subtype: data.subtype,
        usage: data.usage,
        timestamp: Date.now(),
      };
    }

    if (data.type === 'tool_use') {
      return {
        type: 'tool_use',
        content: '',
        toolName: data.toolName || '',
        toolInput: data.toolInput || {},
        toolUseId: data.toolUseId,
        timestamp: Date.now(),
      };
    }

    if (data.type === 'tool_confirmation') {
      return {
        type: 'tool_confirmation',
        content: data.content || '',
        toolName: data.toolName || '',
        toolInput: data.toolInput || {},
        toolUseId: data.toolUseId,
        timestamp: Date.now(),
      };
    }

    if (data.type === 'tool_result') {
      return {
        type: 'tool_result',
        content: '',
        toolResult: typeof data.content === 'string' ? data.content : JSON.stringify(data.content),
        toolUseId: data.toolUseId,
        timestamp: Date.now(),
      };
    }

    if (data.type === 'result') {
      return {
        type: 'system',
        content: '',
        subtype: 'result',
        sessionId: data.sessionId,
        costUsd: data.costUsd,
        durationMs: data.durationMs,
        usage: data.usage,
        timestamp: Date.now(),
      };
    }

    if (data.type === 'error') {
      return {
        type: 'system',
        content: data.message || 'Unknown error',
        subtype: 'error',
        retryAfter: data.retryAfter,
        timestamp: Date.now(),
      };
    }

    if (data.type === 'system') {
      return {
        type: 'system',
        content: data.content || '',
        subtype: data.subtype,
        sessionId: data.sessionId,
        timestamp: Date.now(),
      };
    }

    // Unknown type — pass through
    return {
      type: 'system',
      content: `[${data.type}] ${JSON.stringify(data)}`,
      timestamp: Date.now(),
    };
  } catch (e) {
    console.warn('[ClaudBan] parse error:', line.substring(0, 200), e);
    return null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/stream-parser.ts
git commit -m "feat: rewrite stream-parser for sidecar protocol"
```

---

### Task 6: Rewrite `claude-process.ts`

**Files:**
- Rewrite: `src/services/claude-process.ts`

- [ ] **Step 1: Rewrite with sidecar spawn API**

Replace the entire file. The new API is event-driven instead of blocking:

```typescript
import { Command } from '@tauri-apps/plugin-shell';
import type { StreamMessage } from '../types';
import { parseStreamLine } from './stream-parser';

interface SidecarProcess {
  write: (data: string) => Promise<void>;
  kill: () => void;
}

// Track running sidecar processes by cardId
const processes = new Map<string, SidecarProcess>();
const messageCallbacks = new Map<string, (msg: StreamMessage) => void>();

export function onMessage(cardId: string, callback: (msg: StreamMessage) => void): void {
  messageCallbacks.set(cardId, callback);
}

export function offMessage(cardId: string): void {
  messageCallbacks.delete(cardId);
}

function dispatchMessage(cardId: string, msg: StreamMessage): void {
  const cb = messageCallbacks.get(cardId);
  if (cb) cb(msg);
}

export async function spawnSession(
  cardId: string,
  projectPath: string,
  prompt: string,
  sessionId?: string,
): Promise<void> {
  // Kill existing process for this card if any
  if (processes.has(cardId)) {
    await killProcess(cardId);
  }

  const command = Command.sidecar('binaries/agent-bridge');
  const child = await command.spawn();

  let lineBuffer = '';

  command.stdout.on('data', (data: string) => {
    lineBuffer += data;
    const lines = lineBuffer.split('\n');
    // Keep the last incomplete line in the buffer
    lineBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = parseStreamLine(line);
      if (msg) {
        dispatchMessage(cardId, msg);
      }
    }
  });

  command.stderr.on('data', (data: string) => {
    console.warn('[ClaudBan] sidecar stderr:', data);
  });

  command.on('close', (payload) => {
    // Flush remaining buffer
    if (lineBuffer.trim()) {
      const msg = parseStreamLine(lineBuffer);
      if (msg) dispatchMessage(cardId, msg);
      lineBuffer = '';
    }
    processes.delete(cardId);
    messageCallbacks.delete(cardId);
    console.log('[ClaudBan] sidecar closed, code:', payload.code);
  });

  command.on('error', (err: string) => {
    console.error('[ClaudBan] sidecar error:', err);
    dispatchMessage(cardId, {
      type: 'system',
      content: `Sidecar error: ${err}`,
      timestamp: Date.now(),
    });
    processes.delete(cardId);
  });

  const proc: SidecarProcess = {
    write: async (data: string) => {
      await child.write(data + '\n');
    },
    kill: () => {
      child.kill();
    },
  };

  processes.set(cardId, proc);

  // Send the start command
  const startCmd = JSON.stringify({
    cmd: 'start',
    prompt,
    projectPath,
    ...(sessionId ? { sessionId } : {}),
  });
  await proc.write(startCmd);
}

export async function sendReply(cardId: string, content: 'allow' | 'deny'): Promise<void> {
  const proc = processes.get(cardId);
  if (!proc) return;
  await proc.write(JSON.stringify({ cmd: 'reply', content }));
}

export async function interrupt(cardId: string): Promise<void> {
  const proc = processes.get(cardId);
  if (!proc) return;
  await proc.write(JSON.stringify({ cmd: 'interrupt' }));
}

export async function killProcess(cardId: string): Promise<void> {
  const proc = processes.get(cardId);
  if (!proc) return;
  try {
    await proc.write(JSON.stringify({ cmd: 'stop' }));
  } catch {
    // Process may already be dead
  }
  proc.kill();
  processes.delete(cardId);
}

export function isProcessActive(cardId: string): boolean {
  return processes.has(cardId);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/claude-process.ts
git commit -m "feat: rewrite claude-process with sidecar spawn API"
```

---

### Task 7: Update sessions store

**Files:**
- Modify: `src/stores/sessions.ts`

- [ ] **Step 1: Rewrite the store to use event-driven sidecar API**

Replace imports and the `send()` function. The store now uses `spawnSession` + `onMessage` instead of `executeClaudeTurn`:

```typescript
import { defineStore } from 'pinia';
import { ref, reactive } from 'vue';
import type { StreamMessage } from '../types';
import {
  spawnSession, sendReply, interrupt, killProcess, isProcessActive, onMessage, offMessage,
} from '../services/claude-process';
import { useCardsStore } from './cards';

export const useSessionsStore = defineStore('sessions', () => {
  const messages: Record<string, StreamMessage[]> = reactive({});
  const activeChatCardId = ref<string | null>(null);

  function getMessages(cardId: string): StreamMessage[] {
    return messages[cardId] || [];
  }

  function appendMessage(cardId: string, msg: StreamMessage): void {
    if (!messages[cardId]) { messages[cardId] = []; }
    if (msg.type === 'system' && !msg.content && !msg.sessionId) return;
    messages[cardId].push(msg);
  }

  function setupMessageListener(cardId: string): void {
    onMessage(cardId, (msg: StreamMessage) => {
      const cardsStore = useCardsStore();

      // Capture session ID from init or result messages
      if (msg.sessionId) {
        cardsStore.updateCardSessionId(cardId, msg.sessionId);
      }

      // On result message, set card to idle
      if (msg.subtype === 'result') {
        cardsStore.updateCardState(cardId, 'idle');
        // Don't append empty result messages to chat
        if (!msg.content) return;
      }

      // On error, set card to error state
      if (msg.subtype === 'error') {
        cardsStore.updateCardState(cardId, 'error');
      }

      appendMessage(cardId, msg);
    });
  }

  async function send(cardId: string, message: string): Promise<void> {
    const cardsStore = useCardsStore();
    const card = cardsStore.cards.find(c => c.id === cardId);

    appendMessage(cardId, { type: 'user', content: message, timestamp: Date.now() });

    if (isProcessActive(cardId)) {
      appendMessage(cardId, { type: 'system', content: 'Waiting for current response to finish...', timestamp: Date.now() });
      return;
    }

    const project = (await import('./projects')).useProjectsStore().activeProject;
    if (!project) return;

    await cardsStore.updateCardState(cardId, 'active');

    // Set up listener before spawning so we don't miss early messages
    setupMessageListener(cardId);

    // Determine session ID for resume
    const sessionId = card?.sessionId && !card.sessionId.startsWith('pending-')
      ? card.sessionId : undefined;

    try {
      await spawnSession(cardId, project.path, message, sessionId);
    } catch (err) {
      appendMessage(cardId, { type: 'system', content: `Error: ${err}`, timestamp: Date.now() });
      await cardsStore.updateCardState(cardId, 'idle');
      offMessage(cardId);
    }
  }

  async function approveToolUse(cardId: string): Promise<void> {
    await sendReply(cardId, 'allow');
  }

  async function rejectToolUse(cardId: string): Promise<void> {
    await sendReply(cardId, 'deny');
  }

  async function interruptSession(cardId: string): Promise<void> {
    await interrupt(cardId);
  }

  async function stopSession(cardId: string): Promise<void> {
    offMessage(cardId);
    await killProcess(cardId);
    const cardsStore = useCardsStore();
    await cardsStore.updateCardState(cardId, 'idle');
  }

  function openChat(cardId: string): void { activeChatCardId.value = cardId; }
  function closeChat(): void { activeChatCardId.value = null; }
  function isActive(cardId: string): boolean { return isProcessActive(cardId); }

  return {
    messages, activeChatCardId,
    getMessages, send, approveToolUse, rejectToolUse,
    interruptSession, stopSession, openChat, closeChat, isActive,
  };
});
```

Key changes:
- Removed `claudeAvailable`, `claudeError`, `verifyClaudeBinary` — the sidecar IS the binary, bundled with the app
- Removed the "Claude is thinking..." workaround — messages stream in naturally
- Added `approveToolUse()`, `rejectToolUse()`, `interruptSession()`
- `send()` is no longer blocking — it spawns and returns

- [ ] **Step 2: Commit**

```bash
git add src/stores/sessions.ts
git commit -m "feat: rewrite sessions store for event-driven sidecar flow"
```

---

### Task 8: Update `ToolCallBlock.vue`

**Files:**
- Modify: `src/components/ToolCallBlock.vue`

- [ ] **Step 1: Update approve/reject to use new store methods**

Change the `approve()` and `reject()` functions:

Old:
```typescript
async function approve() { await sessionsStore.send(props.cardId, 'y'); }
async function reject() { await sessionsStore.send(props.cardId, 'n'); }
```

New:
```typescript
async function approve() { await sessionsStore.approveToolUse(props.cardId); }
async function reject() { await sessionsStore.rejectToolUse(props.cardId); }
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ToolCallBlock.vue
git commit -m "feat: wire ToolCallBlock to sidecar tool approval"
```

---

### Task 9: Update `ChatPanel.vue`

**Files:**
- Modify: `src/components/ChatPanel.vue`

- [ ] **Step 1: Make `sendMessage` non-blocking**

The current code `await`s `sessionsStore.send()` and then clears input. Since `send()` is now non-blocking (spawns sidecar and returns), this already works. But we should clear input immediately after calling send, not after awaiting:

Old:
```typescript
async function sendMessage() {
  ...
  try {
    await sessionsStore.send(cardId, input.value.trim());
    input.value = '';
  } catch (err) { ... }
}
```

New:
```typescript
async function sendMessage() {
  if (!input.value.trim() || !sessionsStore.activeChatCardId) return;
  const cardId = sessionsStore.activeChatCardId;
  const msg = input.value.trim();
  input.value = '';
  sessionsStore.send(cardId, msg);
}
```

The `send()` call is fire-and-forget — messages appear via the reactive store.

- [ ] **Step 2: Remove debug console.log statements**

Remove the `console.log('[ClaudBan] sendMessage called...')` and similar debug lines that are no longer needed.

- [ ] **Step 3: Commit**

```bash
git add src/components/ChatPanel.vue
git commit -m "feat: make ChatPanel non-blocking with sidecar flow"
```

---

## Chunk 3: Tauri Configuration

### Task 10: Update capabilities

**Files:**
- Rewrite: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Replace `claude` scope names with sidecar entry**

Replace the entire `shell:allow-spawn` and `shell:allow-execute` blocks:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capabilities for ClaudBan",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    {
      "identifier": "shell:allow-execute",
      "allow": [
        {
          "name": "binaries/agent-bridge",
          "sidecar": true
        }
      ]
    },
    {
      "identifier": "shell:allow-spawn",
      "allow": [
        {
          "name": "binaries/agent-bridge",
          "sidecar": true
        }
      ]
    },
    "shell:allow-stdin-write",
    "shell:allow-kill",
    "sql:allow-load",
    "sql:allow-execute",
    "sql:allow-select",
    "dialog:allow-open",
    "fs:default",
    {
      "identifier": "fs:allow-exists",
      "allow": [{ "path": "/**" }]
    },
    {
      "identifier": "fs:allow-read",
      "allow": [{ "path": "/**" }]
    },
    {
      "identifier": "fs:allow-write-text-file",
      "allow": [{ "path": "/**" }]
    },
    {
      "identifier": "fs:allow-mkdir",
      "allow": [{ "path": "/**" }]
    },
    {
      "identifier": "fs:allow-write",
      "allow": [{ "path": "/**" }]
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add src-tauri/capabilities/default.json
git commit -m "feat: update capabilities for sidecar instead of claude CLI"
```

---

### Task 11: Clean up removed code

**Files:**
- Modify: `src/stores/settings.ts`
- Modify: `src/types/index.ts`
- Modify: `src/components/GlobalSettings.vue`

- [ ] **Step 1: Remove `claudeBinaryPath` from `GlobalSettings` type**

In `src/types/index.ts`, remove the `claudeBinaryPath` field from `GlobalSettings`:

Old:
```typescript
export interface GlobalSettings {
  claudeBinaryPath: string;
  theme: 'dark' | 'light';
  defaultColumns: ColumnConfig[];
}
```

New:
```typescript
export interface GlobalSettings {
  theme: 'dark' | 'light';
  defaultColumns: ColumnConfig[];
}
```

- [ ] **Step 2: Remove `claudeBinaryPath` from settings store defaults**

In `src/stores/settings.ts`, remove from `DEFAULT_SETTINGS`:

Old:
```typescript
const DEFAULT_SETTINGS: GlobalSettings = {
  claudeBinaryPath: 'claude',
  theme: 'dark',
  ...
};
```

New:
```typescript
const DEFAULT_SETTINGS: GlobalSettings = {
  theme: 'dark',
  ...
};
```

Also remove the `updateClaudePath` function and update the return statement:

Old return:
```typescript
return { settings, loaded, load, save, updateClaudePath };
```

New return:
```typescript
return { settings, loaded, load, save };
```

- [ ] **Step 3: Rewrite `GlobalSettings.vue` — remove Claude binary path UI**

The entire component currently exists to configure `claudeBinaryPath` and verify the binary. Replace with a minimal settings dialog (theme only, or empty placeholder):

```vue
<script setup lang="ts">
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog">
      <div class="dialog-header">
        <h3>Global Settings</h3>
        <button class="close-btn" @click="emit('close')">x</button>
      </div>
      <div class="dialog-body">
        <p class="info-msg">Claude agent is bundled with the application. No configuration needed.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
.dialog { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; width: 420px; }
.dialog-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--border); }
.dialog-header h3 { font-size: 16px; }
.close-btn { font-size: 16px; color: var(--text-muted); padding: 2px 6px; border-radius: 4px; }
.close-btn:hover { background: var(--bg-tertiary); }
.dialog-body { padding: 18px; display: flex; flex-direction: column; gap: 12px; }
.info-msg { font-size: 13px; color: var(--text-secondary); }
</style>
```

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/stores/settings.ts src/components/GlobalSettings.vue
git commit -m "chore: remove claudeBinaryPath setting (sidecar is bundled)"
```

---

### Task 12: End-to-end verification

- [ ] **Step 1: Build the sidecar**

Run: `pnpm build:sidecar`
Expected: Binary created at `src-tauri/binaries/agent-bridge-<target-triple>`

- [ ] **Step 2: Run the Tauri dev server**

Run: `pnpm tauri dev`
Expected: App opens. No errors in console about missing sidecar.

- [ ] **Step 3: Create a card and send a message**

In the app: create a project, create a card, open chat, type "hello", press Send.
Expected: Messages stream in from the sidecar — assistant response appears without "Claude is thinking..." blocking.

- [ ] **Step 4: Test tool approval**

Send a prompt that triggers a tool use requiring approval (e.g., "create a file called test.txt with 'hello world'").
Expected: ToolCallBlock appears with "approval needed" badge and working Approve/Reject buttons.

- [ ] **Step 5: Test kill process**

While Claude is responding, close the chat or stop the session.
Expected: Sidecar process terminates cleanly.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete Agent SDK sidecar migration"
```
