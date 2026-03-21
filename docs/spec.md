# Spec: Fix Tool Approval (Allow/Deny) Flow

## Problem Statement

When the Claude Agent SDK requests tool approval (because the session is not in YOLO/auto-approve mode), OnCraft displays a `ToolApprovalBar` with "Allow" and "Deny" buttons. Clicking "Allow" frequently fails silently — the command never executes, and the agent responds with an error like:

> "There's a bug in the permission dialog rendering that's blocking all shell commands — they're not even reaching execution, they fail at the approval stage."

The root cause is a **race condition** in `src-sidecar/agent-bridge.ts`: the sidecar emits `tool_confirmation` over stdout *before* assigning the `pendingApproval` callback. If the frontend processes the message and sends back the `reply` command before `pendingApproval` is set, the reply is silently discarded. The SDK's `canUseTool` Promise then never resolves, leaving the session permanently stuck.

### Affected files

| File | Role in the bug |
|------|-----------------|
| `src-sidecar/agent-bridge.ts` | Emits `tool_confirmation` before `pendingApproval` is assigned (lines 676-697); discards `reply` when `pendingApproval` is null (lines 554-562) |
| `app/services/claude-process.ts` | Sends `reply` command — functions correctly, but the sidecar may not be ready to receive it |
| `app/stores/sessions.ts` | `approveToolUse()` / `rejectToolUse()` — functions correctly |
| `app/components/ToolApprovalBar.vue` | UI — functions correctly |

## Requirements

### REQ-1: Fix emit/assign ordering in `canUseTool`

**Description**: Assign `pendingApproval` before emitting `tool_confirmation` to ensure the sidecar is ready to receive the reply before the frontend can possibly send one.

**Acceptance criteria**:
- `pendingApproval` is assigned (via `new Promise`) before `emit({ type: "tool_confirmation", ... })` is called.
- The `canUseTool` callback still returns the correct `PermissionResult` (`allow` or `deny`) to the SDK.

### REQ-2: Buffer early replies that arrive before `pendingApproval` is set

**Description**: As a defense-in-depth measure, if a `reply` command arrives when `pendingApproval` is `null`, buffer it instead of discarding it. When `pendingApproval` is subsequently assigned, resolve it immediately with the buffered reply.

**Acceptance criteria**:
- A `reply` that arrives before `pendingApproval` is assigned is stored in a buffer variable (e.g. `pendingReply`).
- When `canUseTool` assigns `pendingApproval`, it checks for a buffered reply and resolves immediately if one exists.
- The buffer is cleared after consumption.
- Only one reply is buffered at a time (there can only be one pending approval).

### REQ-3: Do not silently discard `reply` commands

**Description**: The current code falls through to the `Unknown command` error handler when `pendingApproval` is null. The `reply` command should always be recognized and handled.

**Acceptance criteria**:
- A `reply` command never triggers the `Unknown command` error path.
- If a `reply` arrives with no pending approval and no buffer slot is available, it is logged to stderr as a warning (not an error emitted to the frontend).

## Constraints

- **Single file change**: All fixes are in `src-sidecar/agent-bridge.ts`. No frontend changes required.
- **No SDK API changes**: The `canUseTool` callback signature and `PermissionResult` return type must remain unchanged.
- **No behavioral change for YOLO mode**: Sessions using `permissionMode: "bypassPermissions"` do not invoke `canUseTool` and are unaffected.
- **Backward compatible**: The `reply` command format (`{ cmd: 'reply', content: 'allow'|'deny', updatedInput?: ... }`) remains unchanged.

## Out of Scope

- Redesigning the tool approval UI or UX.
- Adding timeout/retry logic if the user never responds to a tool approval.
- Changes to the frontend `ToolApprovalBar`, `sessions.ts`, or `claude-process.ts` (they are functioning correctly).
- Adding automated tests for the sidecar (the sidecar is a single-file Bun binary with no test harness; adding one is a separate effort).
- Handling multiple concurrent tool approvals (the SDK issues them one at a time).

## Edge Cases

| Scenario | Expected behavior |
|----------|-------------------|
| User clicks "Allow" very fast after tool_confirmation appears | Reply is buffered if `pendingApproval` not yet assigned; resolved immediately when assigned |
| User clicks "Deny" | Same flow as Allow — `{ content: 'deny' }` is sent and handled identically |
| `interrupt` arrives while tool approval is pending | Existing behavior: abort controller fires, `canUseTool` Promise rejects via AbortError, session restarts cleanly |
| `stop` arrives while tool approval is pending | Existing behavior: `pendingApproval` is resolved with `deny`, process exits |
| Two rapid `reply` commands arrive | Only the first is consumed (one approval at a time); the second is logged as a warning |
