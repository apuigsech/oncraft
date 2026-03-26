# Spec: Bump claude-agent-sdk 0.2.76 → 0.2.84

## Problem Statement

OnCraft's sidecar (`agent-bridge.ts`) uses `@anthropic-ai/claude-agent-sdk` version 0.2.76, which is 8 minor versions behind the latest (0.2.84). This gap means:

1. **A latent bug in tool approval** — the `canUseTool` callback conditionally spreads `updatedInput`, but the CLI's Zod schema requires it. This causes tool approvals (Allow) to fail silently for tools that go through `canUseTool` (Bash, MCP tools).
2. **Missing information in the UI** — the SDK now provides `title`, `displayName`, and `description` in the `canUseTool` callback, plus new message types (`api_retry`, `session_state_changed`) that would improve user feedback.
3. **No telemetry classification** — the SDK now supports `decisionClassification` on permission results, which we don't send.
4. **No abort signal handling** — the `canUseTool` callback now receives an `AbortSignal` that we ignore, causing `pendingApproval` promises to leak when the user interrupts a session.

## Requirements

### R1: Fix `updatedInput` bug (Critical)

Always include `updatedInput` in the `PermissionResult` when `behavior` is `"allow"`, falling back to the original `input` if the frontend didn't provide one.

**Acceptance criteria:**
- `canUseTool` returns `{ behavior: "allow", updatedInput: reply.updatedInput ?? input }` in all cases.
- Tool approval works for Bash, MCP tools, and all other tools that go through `canUseTool`.

### R2: Forward `title` / `displayName` / `description` to frontend (High)

Pass the new permission prompt fields from the `canUseTool` options through to the frontend via the `tool_confirmation` message.

**Acceptance criteria:**
- `tool_confirmation` messages include `title`, `displayName`, and `description` when the SDK provides them.
- `ToolApprovalBar.vue` uses `title` as the primary prompt text when present, falling back to the current reconstructed text.

### R3: Add `decisionClassification` to permission results (High)

Send telemetry classification with every permission decision so the CLI can report accurate telemetry.

**Acceptance criteria:**
- Allow → `decisionClassification: "user_temporary"`.
- Deny → `decisionClassification: "user_reject"`.

### R4: Translate `api_retry` messages (High)

Surface API retry events to the user so they know when the API is retrying rather than seeing an unresponsive session.

**Acceptance criteria:**
- `translateMessage()` handles `system` messages with `subtype: "api_retry"`.
- A new `api_retry` type is registered in `chat-part-registry.ts`.
- The UI shows retry info (attempt number, delay, error status).

### R5: Translate `session_state_changed` messages (High)

Use the authoritative session state signal from the SDK for more reliable idle/running state tracking.

**Acceptance criteria:**
- `translateMessage()` handles `system` messages with `subtype: "session_state_changed"`.
- The frontend receives `{ type: "session_state_changed", state: "idle" | "running" | "requires_action" }`.

### R6: Handle `AbortSignal` in `canUseTool` (Medium)

Use the `signal` from `canUseTool` options to automatically clean up pending approval promises when the SDK aborts.

**Acceptance criteria:**
- When `signal` fires `abort`, `pendingApproval` resolves with deny and is cleaned up.
- No more leaked promises when the user interrupts during a tool approval wait.

### R7: Bump the dependency version (Medium)

Update `src-sidecar/package.json` to `@anthropic-ai/claude-agent-sdk: "^0.2.84"` and regenerate the lockfile.

**Acceptance criteria:**
- `src-sidecar/package.json` specifies `^0.2.84`.
- `bun.lock` is regenerated.
- Sidecar compiles successfully with `bun build --compile`.

## Constraints

- **`updatedInput` workaround must remain.** The CLI Zod schema still requires `updatedInput` as non-optional in v0.2.84. Our workaround is necessary until Anthropic fixes this upstream.
- **No changes to the sidecar stdin/stdout protocol schema.** New fields in existing messages (e.g., `title` in `tool_confirmation`) are additive. The frontend must gracefully handle their absence for backward compatibility during development.
- **Sidecar must compile with Bun.** All changes must be compatible with `bun build --compile --target=bun`.

## Out of Scope

The following items were identified during analysis but are deferred to separate cards:

- **`applyFlagSettings()`** — mid-session model/permission changes. Requires new sidecar protocol command + frontend UI. Separate feature.
- **`taskBudget`** — token budget per turn. Requires FlowState schema changes. Separate feature.
- **`seedReadState()`** — seeding read state after compact for FileViewer. Requires integration with the FileViewer component. Separate feature.
- **Bridge module** (`@anthropic-ai/claude-agent-sdk/bridge`) — remote session support via claude.ai. Not relevant for local use.
- **New hook events** (`StopFailure`, `TaskCreated`, `CwdChanged`, `FileChanged`) — useful but independent of the SDK bump itself.
- **`initialPrompt`** for agents — requires FlowState agent config changes. Separate feature.
- **TypeScript 6.0 upgrade** — major version change, separate evaluation needed.
- **`portable-pty` 0.8 → 0.9** — Rust crate, unrelated to this SDK bump.
