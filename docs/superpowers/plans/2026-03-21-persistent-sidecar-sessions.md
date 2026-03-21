# Persistent Sidecar Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Claude CLI process alive between user turns so background processes (servers, watchers) survive across turns.

**Architecture:** Replace the per-turn `query({ prompt: "string" })` pattern with a single persistent `query({ prompt: asyncIterable })` per card session. A `MessageStream` class acts as an async queue between stdin commands and the SDK's internal `streamInput` loop.

**Tech Stack:** TypeScript (Bun-compiled sidecar), `@anthropic-ai/claude-agent-sdk`

**Spec:** `docs/superpowers/specs/2026-03-21-persistent-sidecar-sessions-design.md`

---

## File Structure

Only one file changes:

| File | Responsibility |
|------|---------------|
| `src-sidecar/agent-bridge.ts` | Sidecar entry point. Receives JSON commands on stdin, manages SDK `query()` lifecycle, emits translated messages on stdout. All changes are here. |

The file currently has these logical sections (line numbers for orientation):
- **Lines 1-6**: Imports
- **Lines 8-29**: `loadClaudeEnv()` helper (unchanged)
- **Lines 31-38**: `emit()` / `emitError()` helpers (unchanged)
- **Lines 40-46**: State variables (`pendingApproval`, `currentAbort`)
- **Lines 48-334**: `translateMessage()` function (unchanged)
- **Lines 336-337**: Readline setup (unchanged)
- **Lines 339-709**: Main `rl.on("line")` handler — the bulk of the refactor
- **Lines 711-714**: `rl.on("close")` handler

---

## Task 1: Add `MessageStream` class

**Files:**
- Modify: `src-sidecar/agent-bridge.ts` (insert after line 46, before `translateMessage`)

This is the core new component — an async iterable queue that the SDK consumes via `for await`.

- [ ] **Step 1: Add the `MessageStream` class**

Insert this class after the state variables section (after line 46) and before the `translateMessage` function (line 48):

```typescript
// ---- async message queue for persistent sessions ----
// Single-consumer queue: the SDK's streamInput loop is the only consumer.
// Messages are enqueued from stdin commands and pulled by the SDK at its own pace.
class MessageStream {
  private queue: SDKUserMessage[] = [];
  private waitResolve: ((result: IteratorResult<SDKUserMessage>) => void) | null = null;
  private isDone: boolean = false;

  enqueue(msg: SDKUserMessage): void {
    if (this.isDone) return;
    if (this.waitResolve) {
      const r = this.waitResolve;
      this.waitResolve = null;
      r({ done: false, value: msg });
    } else {
      this.queue.push(msg);
    }
  }

  finish(): void {
    this.isDone = true;
    if (this.waitResolve) {
      const r = this.waitResolve;
      this.waitResolve = null;
      r({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return this;
  }

  next(): Promise<IteratorResult<SDKUserMessage>> {
    if (this.queue.length > 0) {
      return Promise.resolve({ done: false, value: this.queue.shift()! });
    }
    if (this.isDone) {
      return Promise.resolve({ done: true, value: undefined });
    }
    return new Promise((resolve) => { this.waitResolve = resolve; });
  }
}
```

- [ ] **Step 2: Verify the sidecar still compiles**

Run:
```bash
cd src-sidecar && ~/.bun/bin/bun build --compile --target=bun agent-bridge.ts --outfile ../src-tauri/binaries/agent-bridge-$(rustc -vV | sed -n 's/host: //p')
```
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src-sidecar/agent-bridge.ts
git commit -m "$(cat <<'EOF'
feat(sidecar): add MessageStream async iterable queue

Async queue that bridges stdin commands to the SDK's streamInput loop.
Messages are enqueued from cmd:start and consumed by for-await at the
SDK's pace. This is the foundation for persistent sessions.
EOF
)"
```

---

## Task 2: Rewrite state, helpers, session loop, and all command handlers

**Files:**
- Modify: `src-sidecar/agent-bridge.ts` (state section, new helpers, and all command handlers)

This task is atomic — it replaces state variables, adds new helpers, adds the session loop, and rewrites all affected command handlers in one pass. This ensures the sidecar compiles at every commit boundary (no intermediate state where `currentAbort` is removed but still referenced).

### Step 2a: Replace state variables and add helpers

- [ ] **Step 1: Replace state variables (lines 40-46)**

Replace:

```typescript
// ---- state ----
interface ReplyPayload {
  content: string;
  updatedInput?: Record<string, unknown>;
}
let pendingApproval: ((answer: ReplyPayload) => void) | null = null;
let currentAbort: AbortController | null = null;
```

With:

```typescript
// ---- state ----
interface ReplyPayload {
  content: string;
  updatedInput?: Record<string, unknown>;
}
let pendingApproval: ((answer: ReplyPayload) => void) | null = null;

// Persistent session state
let activeStream: MessageStream | null = null;
let activeAbort: AbortController | null = null;
let activeSessionConfig: { projectPath: string; sessionId?: string } | null = null;
let sessionAlive: boolean = false;
let knownSessionId: string | null = null;
```

- [ ] **Step 2: Add `buildUserMessage` helper**

Insert after the `MessageStream` class (added in Task 1) and before `translateMessage`:

```typescript
// ---- build SDK user message from stdin command data ----
function buildUserMessage(
  prompt: string,
  imagePaths?: { path: string; mediaType: string }[],
  sessionId?: string,
): SDKUserMessage {
  const content: Record<string, unknown>[] = [];

  if (imagePaths?.length) {
    for (const img of imagePaths) {
      try {
        const data = readFileSync(img.path, "base64");
        content.push({
          type: "image",
          source: { type: "base64", media_type: img.mediaType, data },
        });
        try { unlinkSync(img.path); } catch { /* ignore */ }
      } catch (err) {
        process.stderr.write(`[agent-bridge] failed to read image ${img.path}: ${err}\n`);
      }
    }
  }

  content.push({ type: "text", text: prompt });

  return {
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
    session_id: sessionId || "",
  } as unknown as SDKUserMessage;
}
```

### Step 2b: Add `runSession` background loop

- [ ] **Step 3: Add `runSession` function**

Insert before the `// ---- main loop ----` section (before the `const rl = createInterface(...)` line):

```typescript
// ---- persistent session loop ----
// Runs in background (not awaited) for the lifetime of the card session.
// The for-await loop consumes messages from the SDK as they arrive.
// It exits when the MessageStream finishes or an error/abort occurs.
async function runSession(
  stream: MessageStream,
  options: Record<string, unknown>,
): Promise<void> {
  sessionAlive = true;
  try {
    const conversation = query({ prompt: stream as any, options });
    for await (const message of conversation) {
      // Capture session ID from init message
      if (message.type === "system") {
        const sysMsg = message as Record<string, unknown>;
        if (sysMsg.subtype === "init" && sysMsg.session_id) {
          knownSessionId = sysMsg.session_id as string;
        }
      }

      const translated = translateMessage(message);
      if (translated) {
        if (Array.isArray(translated)) {
          for (const t of translated) emit(t);
        } else {
          emit(translated);
        }
      }
    }
  } catch (err: unknown) {
    process.stderr.write(`[agent-bridge] session error: ${String(err)}\n`);
    process.stderr.write(`[agent-bridge] error stack: ${(err as Error).stack || "no stack"}\n`);
    if ((err as Error).name === "AbortError") {
      emit({
        type: "system",
        subtype: "interrupted",
        content: "Query interrupted",
      });
    } else {
      emitError(String(err));
      emit({ type: "system", subtype: "session_died", content: String(err) });
    }
  } finally {
    sessionAlive = false;
    activeStream = null;
    activeAbort = null;
    activeSessionConfig = null;
    knownSessionId = null;
  }
}
```

### Step 2c: Rewrite all command handlers

- [ ] **Step 4: Replace the `cmd: "interrupt"` handler (lines 358-364)**

Replace:

```typescript
  // Handle interrupt
  if (cmd.cmd === "interrupt") {
    if (currentAbort) {
      currentAbort.abort();
    }
    return;
  }
```

With:

```typescript
  // Handle interrupt — kill the persistent session, allow fresh start
  if (cmd.cmd === "interrupt") {
    if (activeAbort) {
      // Set sessionAlive=false synchronously BEFORE aborting to prevent
      // race condition where a cmd:start arrives before runSession's
      // finally block executes.
      sessionAlive = false;
      const abort = activeAbort;
      activeStream = null;
      activeAbort = null;
      activeSessionConfig = null;
      knownSessionId = null;
      abort.abort();
    }
    return;
  }
```

- [ ] **Step 5: Replace the `cmd: "stop"` handler (lines 366-369)**

Replace:

```typescript
  // Handle stop
  if (cmd.cmd === "stop") {
    process.exit(0);
  }
```

With:

```typescript
  // Handle stop — clean shutdown of persistent session
  if (cmd.cmd === "stop") {
    // Unblock any pending tool approval so the SDK doesn't hang
    if (pendingApproval) {
      pendingApproval({ content: "deny" });
      pendingApproval = null;
    }
    // Signal the stream to finish — SDK will close the CLI process
    if (activeStream) {
      activeStream.finish();
    }
    process.exit(0);
  }
```

- [ ] **Step 6: Replace the `cmd: "start"` handler (lines 372-486)**

Replace the entire block from `if (cmd.cmd === "start") {` through its closing `return;` with:

```typescript
  // Handle start — create or reuse persistent session
  if (cmd.cmd === "start") {
    const projectPath = cmd.projectPath as string;
    const imagePaths = cmd.imagePaths as { path: string; mediaType: string }[] | undefined;

    if (sessionAlive && activeStream && activeSessionConfig) {
      // Active session exists — enqueue a new user message
      if (activeSessionConfig.projectPath !== projectPath) {
        process.stderr.write(`[agent-bridge] projectPath mismatch: active=${activeSessionConfig.projectPath}, requested=${projectPath}\n`);
        emitError("Cannot change project path within an active session");
        return;
      }
      process.stderr.write(`[agent-bridge] enqueueing message into active session\n`);
      const userMsg = buildUserMessage(
        cmd.prompt as string,
        imagePaths,
        knownSessionId || undefined,
      );
      activeStream.enqueue(userMsg);
      return;
    }

    // No active session — create a new persistent session
    process.stderr.write(`[agent-bridge] starting persistent session, cwd=${projectPath}\n`);

    const stream = new MessageStream();
    const abort = new AbortController();

    activeStream = stream;
    activeAbort = abort;
    activeSessionConfig = {
      projectPath,
      sessionId: cmd.sessionId as string | undefined,
    };

    // Build and enqueue the first user message
    const userMsg = buildUserMessage(
      cmd.prompt as string,
      imagePaths,
    );
    stream.enqueue(userMsg);

    // Build query options (same as before, but bound once per session)
    const queryOptions = {
      pathToClaudeCodeExecutable: cliPath,
      executable: "node",
      env: claudeEnv,
      cwd: projectPath,
      resume: cmd.sessionId ? (cmd.sessionId as string) : undefined,
      abortController: abort,
      model: (cmd.model as string) || undefined,
      effort: (cmd.effort as string) || undefined,
      permissionMode: (cmd.permissionMode as string) || "default",
      settingSources: ["user", "project"],
      includePartialMessages: true,
      ...(cmd.worktreeName ? {
        extraArgs: { worktree: cmd.worktreeName as string },
      } : {}),
      canUseTool: async (
        toolName: string,
        input: Record<string, unknown>,
        options: { toolUseID: string },
      ): Promise<PermissionResult> => {
        emit({
          type: "tool_confirmation",
          toolName,
          toolInput: input,
          toolUseId: options.toolUseID,
        });
        const reply = await new Promise<ReplyPayload>((resolve) => {
          pendingApproval = resolve;
        });
        if (reply.content === "allow") {
          return {
            behavior: "allow" as const,
            ...(reply.updatedInput ? { updatedInput: reply.updatedInput } : {}),
          };
        }
        return { behavior: "deny" as const, message: "User denied" };
      },
    };

    // Launch session in background — do not await
    runSession(stream, queryOptions);
    return;
  }
```

### Step 2d: Update close handler

- [ ] **Step 7: Replace the `rl.on("close")` handler (lines 711-714)**

Replace:

```typescript
// Handle stdin close (Tauri killed us)
rl.on("close", () => {
  process.exit(0);
});
```

With:

```typescript
// Handle stdin close (Tauri killed us) — clean up persistent session
rl.on("close", () => {
  if (activeAbort) activeAbort.abort();
  process.exit(0);
});
```

### Step 2e: Verify and commit

- [ ] **Step 8: Verify the sidecar compiles**

Run:
```bash
cd src-sidecar && ~/.bun/bin/bun build --compile --target=bun agent-bridge.ts --outfile ../src-tauri/binaries/agent-bridge-$(rustc -vV | sed -n 's/host: //p')
```
Expected: Build succeeds with no errors.

- [ ] **Step 9: Commit**

```bash
git add src-sidecar/agent-bridge.ts
git commit -m "$(cat <<'EOF'
feat(sidecar): persistent session with reusable CLI process

Replace per-turn query() with a single persistent query() per card
session using AsyncIterable<SDKUserMessage> as prompt.

- Replace currentAbort with persistent session state (activeStream,
  activeAbort, sessionAlive, knownSessionId)
- Add buildUserMessage() helper for text and multimodal prompts
- Add runSession() background loop with error recovery and
  session_died emission on unexpected errors
- Rewrite cmd:start to create or reuse persistent session
- Rewrite cmd:stop to deny pending approvals and finish stream
- Rewrite cmd:interrupt to synchronously null state (incl.
  knownSessionId) before aborting, preventing race conditions
- Update rl.on('close') to abort before exit

Background processes spawned by Claude (servers, watchers) now
survive between user turns because the CLI process stays alive.
EOF
)"
```

---

## Task 3: Manual integration test

No automated test infrastructure exists for the sidecar. Verification is manual via `pnpm tauri dev`.

- [ ] **Step 1: Build and launch OnCraft**

```bash
pnpm tauri dev
```

- [ ] **Step 2: Test basic conversation flow**

Open a card, send a message, verify response arrives. Send a follow-up message, verify response arrives. This confirms the persistent session model works for normal multi-turn conversations.

- [ ] **Step 3: Test background process survival**

Ask Claude to start a background HTTP server (e.g. "Start a simple HTTP server on port 8765 in the background"). Open `http://localhost:8765` in a browser. Verify it works. Send a follow-up message to the same card. Verify the server is still accessible after the follow-up completes.

- [ ] **Step 4: Test stop cleanup**

Close/stop the card session. Verify `http://localhost:8765` is no longer accessible (port freed).

- [ ] **Step 5: Test interrupt and recovery**

Start a new card session with a long-running task. Click interrupt/cancel. Send a new message. Verify a fresh session starts correctly.

- [ ] **Step 6: Test resume after app restart**

Note the session ID from a card. Close OnCraft. Reopen OnCraft. Open the same card (which resumes the session). Send a message. Verify conversation resumes correctly.
