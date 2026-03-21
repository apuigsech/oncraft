# Persistent Sidecar Sessions

## Problem

When a Claude session running through OnCraft spawns a background process (e.g. a local dev server on `localhost:53030`), that process dies as soon as the current turn completes. The same session works fine in the Claude Code CLI terminal because the CLI process stays alive between turns.

### Root Cause

The SDK's `query()` function determines `isSingleUserTurn` from the prompt type:

```
isSingleUserTurn = typeof prompt === "string"
```

When `prompt` is a string (which is how `agent-bridge.ts` uses it today), the SDK treats the query as single-turn. After the result message arrives, it calls `transport.endInput()` (which closes stdin to the CLI process), then `close()` sends SIGTERM. The CLI process dies, and all its child processes (background servers, watchers, etc.) die with it.

The next turn spawns a brand new `query()` with a fresh CLI process, so any background state from the previous turn is gone.

## Solution

Change `agent-bridge.ts` from spawning one `query()` per user turn to spawning one `query()` per card session, using an `AsyncIterable<SDKUserMessage>` as the prompt instead of a string.

When `prompt` is an AsyncIterable, the SDK sets `isSingleUserTurn = false`. The `streamInput` loop blocks on `next()` from the iterable, keeping the CLI process alive indefinitely. Each user turn enqueues a new message into the iterable; result messages signal turn completion but do not kill the process. The process only dies when we explicitly call `finish()` on the iterable (or abort).

### Why not the v2 API (`unstable_v2_createSession`)?

The v2 API's `SDKSessionOptions` hardcodes critical values that OnCraft needs:

| Feature | `query()` Options | `SDKSessionOptions` (v2) |
|---------|------------------|--------------------------|
| `cwd` | Configurable | Not available |
| `effort` | Configurable | Not available |
| `extraArgs` (worktree) | Configurable | Hardcoded `{}` |
| `settingSources` | Configurable | Hardcoded `[]` |
| `includePartialMessages` | Configurable | Hardcoded `false` |

The v2 API does support some features OnCraft needs (`canUseTool`, `permissionMode`, `allowedTools`), but the missing ones above are blockers. Migrating to v2 would break worktrees, effort config, streaming tokens, project settings, and working directory. The v2 API is alpha and not ready for OnCraft's needs.

## Design

### New component: `MessageStream`

A simple async iterable that acts as a message queue. Messages are enqueued from stdin commands and consumed by the SDK's `streamInput` loop at its own pace.

```typescript
class MessageStream {
  private queue: SDKUserMessage[] = [];
  private resolve: ((result: IteratorResult<SDKUserMessage>) => void) | null = null;
  private isDone: boolean = false;

  enqueue(msg: SDKUserMessage): void {
    if (this.isDone) return;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r({ done: false, value: msg });
    } else {
      this.queue.push(msg);
    }
  }

  finish(): void {
    this.isDone = true;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
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
    return new Promise((resolve) => { this.resolve = resolve; });
  }
}
```

This is a simplified async queue. The SDK pulls messages via `for await`, which calls `next()`. If no messages are queued, `next()` blocks until `enqueue()` or `finish()` is called. The queue-based design means the SDK pulls messages at its own pace; early enqueues simply wait in the buffer.

### Changed lifecycle in `agent-bridge.ts`

**Current (one query per turn):**

```
stdin: { cmd: "start", prompt: "do X" }
  -> query({ prompt: "do X" })
  -> for await ... yield messages
  -> process dies (SIGTERM)

stdin: { cmd: "start", prompt: "now do Y" }
  -> query({ prompt: "now do Y" })       <- new CLI process
  -> for await ... yield messages
  -> process dies (SIGTERM)
```

**Proposed (one query per card session):**

```
stdin: { cmd: "start", prompt: "do X" }
  -> create MessageStream
  -> stream.enqueue(userMessage("do X"))
  -> query({ prompt: stream })            <- CLI process starts
  -> for await ... yield messages
  -> result arrives -> emit to frontend    <- CLI stays alive

stdin: { cmd: "start", prompt: "now do Y" }
  -> stream.enqueue(userMessage("now do Y"))  <- reuse same CLI process
  -> for await ... yield more messages
  -> result arrives -> emit to frontend

stdin: { cmd: "stop" }
  -> stream.finish()                      <- CLI process exits cleanly
  -> for await loop completes
```

### State management

The sidecar tracks one active session with a health flag:

```typescript
let activeStream: MessageStream | null = null;
let activeAbort: AbortController | null = null;
let activeSessionConfig: { projectPath: string; sessionId?: string } | null = null;
let sessionAlive: boolean = false;  // set true when query starts, false on any termination
let knownSessionId: string | null = null;  // captured from init message
```

The `sessionAlive` flag is set to `true` synchronously when `runSession()` begins and set to `false` synchronously inside the abort handler and in the `finally` block of `runSession()`. This prevents race conditions where a `cmd: "start"` arrives after an abort but before the `runSession` finally block executes.

### Command handling changes

#### `cmd: "start"`

Two cases:

1. **No active session** (`!sessionAlive`): Create `MessageStream`, create `AbortController`, call `query()` with the stream as prompt. Start the `for await` loop in the background (non-blocking). Enqueue the first user message.

2. **Active session exists** (`sessionAlive === true`): Validate that `projectPath` matches (same card). Enqueue a new user message into the existing stream. The `for await` loop picks it up automatically.

**Known limitation**: Session config changes (model, effort, permissionMode, worktreeName) between turns are not picked up because those are CLI arguments passed at process spawn time. Changing these settings requires stopping and restarting the session. This matches the behavior of the Claude Code CLI terminal, where you must start a new session to change the model.

#### `cmd: "stop"`

1. If `pendingApproval` is non-null, resolve it with `{ content: "deny" }` to unblock the SDK.
2. Call `activeStream.finish()` to signal the iterable is done.
3. The SDK's `streamInput` loop exits, waits for the last result, then calls `endInput()` and `close()`, which terminates the CLI process and its children.
4. Then `process.exit(0)`.

#### `cmd: "interrupt"`

1. Set `sessionAlive = false` synchronously (prevents race with subsequent `cmd: "start"`).
2. Null out `activeStream` and `activeSessionConfig` synchronously.
3. Call `activeAbort.abort()`. The SDK aborts the current operation and kills the CLI process.
4. The `runSession` catch block handles the `AbortError`.
5. The next `cmd: "start"` sees `sessionAlive === false` and creates a fresh session.

#### `cmd: "reply"` (tool approval)

No change. The pending approval promise resolves the same way.

#### Utility commands (`loadHistory`, `listSessions`, `listCommands`, `deleteSession`)

No change. These commands are independent of the active query and are processed by separate code paths in the stdin handler. They work the same during a persistent session.

### Building `SDKUserMessage` from stdin commands

The `cmd: "start"` payload contains `prompt` (string) and optionally `imagePaths`. We construct a proper `SDKUserMessage`:

```typescript
function buildUserMessage(
  prompt: string,
  imagePaths?: { path: string; mediaType: string }[],
  sessionId?: string,
): SDKUserMessage {
  const content: Record<string, unknown>[] = [];

  if (imagePaths?.length) {
    for (const img of imagePaths) {
      const data = readFileSync(img.path, "base64");
      content.push({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data },
      });
      try { unlinkSync(img.path); } catch {}
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

Note: `session_id` uses the known session ID (captured from the `init` message) for subsequent messages. The first message uses `""` since the session ID isn't known yet. This matches how the SDK constructs user messages internally.

### The `for await` loop

The loop structure changes from synchronous (blocks until query completes) to long-lived (runs for the entire card session):

```typescript
async function runSession(stream: MessageStream, options: QueryOptions) {
  sessionAlive = true;
  try {
    const conversation = query({ prompt: stream as any, options });
    for await (const message of conversation) {
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
    if ((err as Error).name === "AbortError") {
      emit({ type: "system", subtype: "interrupted", content: "Query interrupted" });
    } else {
      process.stderr.write(`[agent-bridge] session error: ${String(err)}\n`);
      emitError(String(err));
      // Emit a distinct message so the frontend knows the persistent session died
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

Key behaviors:
- `sessionAlive = true` is set synchronously at the top, before any await.
- `sessionAlive = false` is set in `finally`, guaranteeing cleanup.
- On unexpected errors (not abort), a `session_died` message is emitted so the frontend can react (e.g., show an error state on the card). The next `cmd: "start"` will create a fresh session.
- `runSession()` is called without `await` from the `cmd: "start"` handler, so stdin processing continues while the loop runs.

### Stdin close handler

The `rl.on('close')` handler (triggered when the frontend kills the sidecar process) must clean up the persistent session:

```typescript
rl.on("close", () => {
  if (activeAbort) activeAbort.abort();
  process.exit(0);
});
```

This ensures the CLI child process receives the abort signal before the sidecar exits.

### Frontend changes

**None required.** The frontend already:

- Manages sidecar lifecycle per card via `claude-process.ts`
- Sends `cmd: "start"` for each user turn with the session ID
- Sends `cmd: "stop"` when killing a card's process
- Handles `result` messages to mark turns as complete

The protocol between frontend and sidecar is unchanged. The sidecar simply reuses the same CLI process internally instead of spawning a new one each turn.

The frontend should handle the new `session_died` system message gracefully. Since unknown system subtypes already fall through to a generic handler in `stream-parser.ts`, this works without code changes. An optional follow-up could add explicit handling to show a more descriptive error state.

### Session ID handling

On the first `cmd: "start"`, we pass `resume: sessionId` to `query()` if a session ID is provided. On subsequent starts within the same session, we don't need to pass the session ID again --- the CLI process already has it.

The `init` system message (with session ID) is emitted once when the CLI process starts. We capture it into `knownSessionId` for use in subsequent `buildUserMessage` calls. The frontend already handles this correctly.

### Edge cases

**Card with existing session resumed after app restart**: The sidecar is spawned fresh by the frontend. The first `cmd: "start"` creates a new `query()` with `resume: sessionId`. This is the same as today.

**User sends a message while previous turn is still running**: The `MessageStream.enqueue()` queues it. The SDK processes messages sequentially, so the new message will be processed after the current turn's result. This is safe because the SDK's internal stream processing serializes message handling.

**Rapid `cmd: "start"` before `query()` initializes**: The `MessageStream` queue handles this naturally. The SDK's `streamInput` loop pulls messages from the iterable when ready; earlier enqueued messages wait in the buffer until the CLI process is initialized and the transport is accepting writes.

**Sidecar process crashes**: The frontend's `command.on('close')` handler fires and cleans up, same as today.

**Multiple cards**: Each card spawns its own sidecar process. No shared state.

**`cmd: "stop"` while tool approval is pending**: The stop handler resolves the pending approval with `deny` before finishing the stream, ensuring the SDK is not left hanging on an unresolved promise.

**Session dies unexpectedly (SDK error, CLI crash)**: The `runSession` catch block emits `session_died`. The `finally` block resets all state. The next `cmd: "start"` creates a fresh session.

**`cmd: "start"` arrives between abort and `runSession` finally**: The `sessionAlive` flag is set to `false` synchronously in the interrupt handler (before `abort()` is called), so the `cmd: "start"` handler correctly sees no active session and creates a fresh one.

## Files changed

| File | Change |
|------|--------|
| `src-sidecar/agent-bridge.ts` | Add `MessageStream` class. Add `sessionAlive` and `knownSessionId` state. Refactor `cmd: "start"` handler to create/reuse persistent session. Refactor `cmd: "stop"` to deny pending approvals then finish stream. Refactor `cmd: "interrupt"` to synchronously null state before aborting. Extract `buildUserMessage()` helper. Move `for await` loop to background `runSession()` function. Update `rl.on('close')` to abort before exit. |

No other files change. The frontend protocol is identical.

## Verification

1. Start a card session, ask Claude to start a background HTTP server
2. Verify the server URL is accessible in a browser
3. Send a follow-up message in the same card
4. Verify the server is still running after the follow-up completes
5. Stop the card session
6. Verify the server process is cleaned up (port freed)
7. Start a card session with a background server, interrupt mid-turn, verify the session and background processes are cleaned up
8. Start a new turn after interrupt, verify a fresh session is created correctly
