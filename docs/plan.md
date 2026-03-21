# Plan: Fix Tool Approval (Allow/Deny) Flow

**Spec**: [docs/spec.md](spec.md)
**File to modify**: `src-sidecar/agent-bridge.ts` (single file)

## Steps

### Step 1: Add `pendingReply` buffer variable

**What**: Add a new state variable `pendingReply` next to the existing `pendingApproval` declaration (line 47). This variable will buffer a reply that arrives before `pendingApproval` is assigned.

**Where**: `src-sidecar/agent-bridge.ts`, line 47 area (state section).

**Change**:
```typescript
// Before:
let pendingApproval: ((answer: ReplyPayload) => void) | null = null;

// After:
let pendingApproval: ((answer: ReplyPayload) => void) | null = null;
let pendingReply: ReplyPayload | null = null;
```

**Satisfies**: REQ-2 (buffer infrastructure)
**Dependencies**: None

---

### Step 2: Rewrite the `reply` command handler

**What**: Change the `reply` handler (lines 554-562) from a single conditional (`if reply && pendingApproval`) to a block that:
1. Always matches on `cmd === "reply"` (not conditioned on `pendingApproval`).
2. If `pendingApproval` exists, resolves it immediately (existing behavior).
3. If `pendingApproval` is null, buffers the reply in `pendingReply` with a stderr warning.
4. If `pendingReply` is already occupied, logs a warning and ignores the duplicate.
5. Always returns early — never falls through to the `Unknown command` handler.

**Where**: `src-sidecar/agent-bridge.ts`, lines 554-562.

**Change**:
```typescript
// Before:
if (cmd.cmd === "reply" && pendingApproval) {
    pendingApproval({
      content: cmd.content as string,
      updatedInput: cmd.updatedInput as Record<string, unknown> | undefined,
    });
    pendingApproval = null;
    return;
}

// After:
if (cmd.cmd === "reply") {
    const payload: ReplyPayload = {
      content: cmd.content as string,
      updatedInput: cmd.updatedInput as Record<string, unknown> | undefined,
    };
    if (pendingApproval) {
      pendingApproval(payload);
      pendingApproval = null;
    } else if (!pendingReply) {
      process.stderr.write("[agent-bridge] reply arrived before pendingApproval — buffering\n");
      pendingReply = payload;
    } else {
      process.stderr.write("[agent-bridge] warning: duplicate reply while buffer occupied — ignoring\n");
    }
    return;
}
```

**Satisfies**: REQ-2 (buffer early replies), REQ-3 (never discard silently)
**Dependencies**: Step 1 (needs `pendingReply` variable)

---

### Step 3: Rewrite the `canUseTool` callback — assign before emit, drain buffer

**What**: In the `canUseTool` callback (lines 676-697), restructure so that:
1. `pendingApproval = resolve` is assigned **first**.
2. Then check if `pendingReply` is already populated (early reply arrived) — if so, resolve immediately and clear buffer.
3. Only if no buffered reply exists, emit `tool_confirmation` to the frontend.

**Where**: `src-sidecar/agent-bridge.ts`, lines 676-697 (inside `queryOptions`).

**Change**:
```typescript
// Before:
canUseTool: async (toolName, input, options): Promise<PermissionResult> => {
    emit({
      type: "tool_confirmation",
      toolName,
      toolInput: input,
      toolUseId: options.toolUseID,
    });
    const reply = await new Promise<ReplyPayload>((resolve) => {
      pendingApproval = resolve;
    });
    ...
}

// After:
canUseTool: async (toolName, input, options): Promise<PermissionResult> => {
    const reply = await new Promise<ReplyPayload>((resolve) => {
      pendingApproval = resolve;
      // Drain buffered reply if one arrived before this callback
      if (pendingReply) {
        const buffered = pendingReply;
        pendingReply = null;
        pendingApproval = null;
        resolve(buffered);
        return;
      }
      // Only emit after pendingApproval is assigned
      emit({
        type: "tool_confirmation",
        toolName,
        toolInput: input,
        toolUseId: options.toolUseID,
      });
    });
    if (reply.content === "allow") {
      return {
        behavior: "allow" as const,
        ...(reply.updatedInput ? { updatedInput: reply.updatedInput } : {}),
      };
    }
    return { behavior: "deny" as const, message: "User denied" };
},
```

**Satisfies**: REQ-1 (assign before emit), REQ-2 (drain buffer)
**Dependencies**: Step 1 (needs `pendingReply`), Step 2 (buffer population logic)

---

### Step 4: Clean up `pendingReply` in `stop` and `interrupt` handlers

**What**: Ensure `pendingReply` is cleared when the session is interrupted or stopped, to prevent stale buffered replies from leaking into a subsequent session.

**Where**: `src-sidecar/agent-bridge.ts`, `interrupt` handler (lines 564-578) and `stop` handler (lines 581-593).

**Change** — in `interrupt`:
```typescript
// Add after line 575 (knownSessionId = null;):
pendingReply = null;
```

**Change** — in `stop`:
```typescript
// Add after line 586 (pendingApproval = null;), or at the start of the stop block:
pendingReply = null;
```

**Satisfies**: Correctness / cleanup (no stale state)
**Dependencies**: Step 1 (needs `pendingReply` variable)

---

### Step 5: Rebuild sidecar and verify

**What**: Rebuild the sidecar binary with `pnpm build:sidecar` and manually test:
1. Start a session in non-YOLO mode.
2. Trigger a tool that requires approval (e.g. Bash).
3. Click "Allow" — command should execute.
4. Click "Deny" — command should be denied.
5. Rapid-click "Allow" before the dialog fully renders — should still work.

**Where**: Terminal / OnCraft app.

**Command**: `pnpm build:sidecar`

**Satisfies**: All REQs (integration verification)
**Dependencies**: Steps 1-4

---

## Dependency Graph

```
Step 1 (add pendingReply var)
  ├── Step 2 (rewrite reply handler)     ── depends on Step 1
  ├── Step 3 (rewrite canUseTool)        ── depends on Step 1, Step 2
  └── Step 4 (cleanup in stop/interrupt) ── depends on Step 1
Step 5 (build & verify)                  ── depends on Steps 1-4
```

Steps 2, 3, and 4 all depend on Step 1 but are independent of each other. In practice they are applied sequentially to the same file.
