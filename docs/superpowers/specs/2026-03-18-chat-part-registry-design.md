# Chat Part Registry — Design Spec

**Date:** 2026-03-18
**Status:** Draft
**Scope:** Structured message pipeline for OnCraft's integrated chat

## Problem

OnCraft's integrated chat displays raw JSON and repetitive unformatted text for many message types coming from the Claude Agent SDK. The root causes:

1. **Sidecar destroys information.** `translateMessage()` in `agent-bridge.ts` has explicit handlers for ~5 SDK message types. The remaining ~15 types fall through to a catch-all that serializes the entire message with `JSON.stringify()` and wraps it as a generic `system` message.

2. **Stream parser loses type identity.** `stream-parser.ts` collapses unknown types into `{ type: 'system', content: '[type] JSON...' }`, making it impossible for downstream code to distinguish between message types.

3. **No structured routing to widgets.** `message-adapter.ts` and `ChatPanel.vue` handle message types with ad-hoc if/else chains. Adding support for a new type requires coordinated changes across 4-5 files.

4. **Interactive messages lack proper widgets.** `AskUserQuestion` renders as a generic tool call with JSON input instead of clickable options. Tool confirmations appear inline instead of as a prominent action bar. Hook events show as raw text.

## Design Principles

- **Sidecar normalizes schema, frontend decides presentation.** The sidecar translates SDK field names (snake_case to camelCase, flatten nesting) and preserves the original message type. It never decides what to show or hide.
- **Single point of truth.** One TypeScript registry file maps every message type to its parser, placement, component, and verbosity level.
- **Extend by adding, not modifying.** Supporting a new SDK message type means adding one entry to the registry and optionally creating a Vue component. No other files need changes.
- **Show everything by default.** All message types render with at least a generic widget. A verbosity level setting controls what is visible.

## Architecture

### Data Flow

```
Claude Agent SDK
  | emits SDKMessage (20+ types)
  v
Sidecar (agent-bridge.ts)
  | translateMessage(): normalize schema, preserve type
  | emits JSON line with original type + clean fields
  | also emits tool_confirmation (from canUseTool callback)
  | and error (from emitError helper) — both bypass translateMessage
  v
claude-process.ts
  | receives stdout lines, JSON.parse each line
  | calls ChatPartRegistry.process() to produce ChatPart
  | dispatches ChatPart to sessions store via callback
  | (replaces current dual-dispatch of message vs progress)
  v
Sessions Store (sessions.ts)
  | stores ChatPart[] per card
  | handles streaming buffer (RAF coalescing for assistant deltas)
  | merges tool_result into matching tool_use ChatPart
  | extracts metrics from result/assistant parts
  v
useChatParts(cardId) composable
  | filters by placement + verbosity
  | exposes: headerParts, inlineParts, actionBarParts, progressParts
  v
ChatPanel.vue
  | renders each zone with dynamic component resolution
```

### Layer Responsibilities

| Layer | Does | Does NOT |
|-------|------|----------|
| Sidecar | Normalize field names, flatten nesting, preserve original type, emit clean JSON | Decide visibility, stringify unknown types, collapse types under `system` |
| claude-process.ts | JSON.parse lines, call registry.process(), dispatch ChatParts to store | Classify messages, store state, decide rendering |
| ChatPartRegistry | Map type to parser/placement/component/verbosity, produce ChatPart | Store state, render UI, handle streaming |
| Sessions Store | Store ChatPart[], manage streaming buffer, merge tool results, extract metrics | Parse raw messages, decide rendering |
| useChatParts | Filter by placement and verbosity, expose per-zone lists | Mutate data |
| ChatPanel | Render zones, resolve components dynamically | Parse or classify messages |

### Note on stream-parser.ts

The current `stream-parser.ts` is eliminated. Its responsibilities (JSON.parse + type-specific handling) are split: JSON.parse moves to `claude-process.ts` (where it already partially lives), and type-specific handling moves to the registry. The `isProgressEvent` / `parseProgressEvent` functions are also eliminated — the registry handles progress types via `placement: 'progress'`.

## Sidecar Changes

### Current Behavior

`translateMessage()` handles: `assistant`, `user`, `result`, `system` (with `init` subtype), `stream_event`. Everything else falls to:

```typescript
return {
  type: "system",
  subtype: (msg as Record<string, unknown>).type as string,
  content: JSON.stringify(msg),
};
```

### New Behavior

Every SDK message type gets an explicit handler that emits the original type with normalized fields. The fallback for truly unknown types becomes:

```typescript
return {
  type: "unknown",
  rawType: String((msg as Record<string, unknown>).type),
  data: msg,
};
```

### Complete Handler Map

These are emitted by `translateMessage()`:

| SDK Type | Emitted `type` | Key Fields |
|----------|----------------|------------|
| `SDKAssistantMessage` | `assistant` | content, subtype (null or `thinking`), usage |
| `SDKUserMessage` | `user` | content, images |
| `SDKUserMessageReplay` | `user` | content (treated same as user) |
| `SDKResultMessage` | `result` | sessionId, costUsd, durationMs, usage |
| `SDKSystemMessage` (subtype: `init`) | `init` | sessionId, gitBranch, model, tools, worktreePath, worktreeBranch |
| `SDKSystemMessage` (other subtypes) | `system` | subtype, content |
| `SDKPartialAssistantMessage` | `assistant` | subtype: `streaming`, content (extracted from delta) |
| `SDKHookStartedMessage` | `hook_started` | hookId, hookName, hookEvent |
| `SDKHookProgressMessage` | `hook_progress` | hookId, hookName, hookEvent, stdout, stderr, output |
| `SDKHookResponseMessage` | `hook_response` | hookId, hookName, hookEvent, output, exitCode, outcome |
| `SDKToolProgressMessage` | `tool_progress` | toolUseId, toolName, elapsedSeconds, taskId |
| `SDKAuthStatusMessage` | `auth_status` | isAuthenticating, output, error |
| `SDKTaskStartedMessage` | `task_started` | taskId, description, taskType, prompt |
| `SDKTaskProgressMessage` | `task_progress` | taskId, description, usage, lastToolName, summary |
| `SDKTaskNotificationMessage` | `task_notification` | taskId, (remaining fields passed through) |
| `SDKStatusMessage` | `status` | status, permissionMode |
| `SDKCompactBoundaryMessage` | `compact_boundary` | compactMetadata |
| `SDKLocalCommandOutputMessage` | `local_command_output` | content |
| `SDKFilesPersistedEvent` | `files_persisted` | files, failed |
| `SDKToolUseSummaryMessage` | `tool_use_summary` | summary, precedingToolUseIds |
| `SDKRateLimitEvent` | `rate_limit_event` | rateLimitInfo |
| `SDKElicitationCompleteMessage` | `elicitation_complete` | mcpServerName, elicitationId |
| `SDKPromptSuggestionMessage` | `prompt_suggestion` | suggestion |
| Unknown | `unknown` | rawType, data (full message object) |

### Messages Emitted Outside translateMessage()

These are emitted by other parts of the sidecar, not by `translateMessage()`:

| Source | Emitted `type` | Key Fields |
|--------|----------------|------------|
| `canUseTool` callback | `tool_confirmation` | toolName, toolInput, toolUseId |
| `emitError()` helper | `error` | message |
| User message `tool_result` blocks | `tool_result` | toolUseId, content |

The `tool_result` messages are extracted from `SDKUserMessage` content blocks of type `tool_result` inside `translateMessage()`. They are emitted as separate messages (as they are today) so the frontend can merge them into the matching `tool_use` ChatPart.

### Assistant Message: text vs thinking

`SDKAssistantMessage` content blocks can be `text`, `tool_use`, or `thinking`. The sidecar emits separate messages for each block:
- `text` blocks: `{ type: "assistant", content: "...", usage: {...} }`
- `thinking` blocks: `{ type: "assistant", subtype: "thinking", content: "..." }`
- `tool_use` blocks: `{ type: "tool_use", toolName: "...", toolInput: {...}, toolUseId: "..." }`

This is unchanged from current behavior.

### What Does NOT Change in the Sidecar

- JSON-lines protocol over stdin/stdout
- `canUseTool` callback for tool confirmation (emits `tool_confirmation`)
- `emitError()` helper (emits `error`)
- Commands: `loadHistory`, `listCommands`, `listSessions`, `deleteSession`
- Streaming mechanics (stream_event extraction of text deltas)
- Extraction of `tool_result` from user message content blocks

## New Data Model

### SidecarMessage

The raw JSON parsed from a sidecar line. Minimal contract — just a type string and arbitrary fields:

```typescript
interface SidecarMessage {
  type: string;
  [key: string]: unknown;
}
```

### ChatPart

The unit the frontend stores and renders:

```typescript
interface ChatPart {
  id: string;
  kind: string;
  placement: 'header' | 'inline' | 'action-bar' | 'progress' | 'hidden';
  timestamp: number;
  data: Record<string, unknown>;
  raw?: Record<string, unknown>;
  resolved?: boolean;  // for action-bar parts: true after user responds
}
```

Field details:
- **`id`**: generated as `${type}-${incrementingCounter}`, e.g. `assistant-0`, `tool_use-3`, `hook_started-7`. The counter is global per card session and increments monotonically.
- **`kind`**: the registry key that was used to resolve this part. For tool overrides, this is the override key (e.g. `tool:AskUserQuestion`), not the raw type. For everything else, it equals the sidecar message's `type`.
- **`placement`**: assigned by the registry definition.
- **`resolved`**: used only for action-bar parts. Set to `true` when the user responds (approve/deny, select option). When resolved, `useChatParts` moves the part from action-bar to inline for historical display.
- **`raw`**: the original `SidecarMessage`, always stored. Used for debug display in verbose mode and for debug tooling. The memory cost is acceptable since messages are ephemeral and capped at `MAX_MESSAGES_PER_CARD` (500).

### Replaces

- **`StreamMessage`** interface in `app/types/index.ts` — replaced by `ChatPart`
- **`AgentProgressEvent`** — absorbed into `ChatPart` with `placement: 'progress'`

### Verbosity Field on SessionConfig

Add `verbosity: VerbosityLevel` to the `SessionConfig` interface:

```typescript
type VerbosityLevel = 'quiet' | 'normal' | 'verbose';

interface SessionConfig {
  model: ModelAlias;
  effort: EffortLevel;
  permissionMode: PermissionMode;
  verbosity: VerbosityLevel;  // NEW — default: 'normal'
  gitBranch?: string;
  worktreeName?: string;
  worktreePath?: string;
  worktreeBranch?: string;
}
```

## Chat Part Registry

### File Location

`app/services/chat-part-registry.ts`

### Definition Interface

```typescript
interface ChatPartDefinition {
  parse: (raw: Record<string, unknown>) => Record<string, unknown>;
  placement: 'header' | 'inline' | 'action-bar' | 'progress' | 'hidden';
  component: string | null;
  verbosity: 'quiet' | 'normal' | 'verbose';
}
```

When `component` is `null`:
- For `placement: 'progress'`, the part feeds the progress bar (no visual component needed).
- For `placement: 'hidden'`, the part is not rendered.
- For `placement: 'inline'`, `'header'`, or `'action-bar'`, `GenericMessageBlock` is used as fallback.

### Resolution Logic

Two-level resolution for tool-specific overrides:

```typescript
function resolve(msg: SidecarMessage): ChatPartDefinition {
  if (msg.type === 'tool_use' && msg.toolName) {
    const override = registry[`tool:${msg.toolName}`];
    if (override) return override;
  }
  return registry[msg.type] || registry['_default'];
}
```

### The process() Function

```typescript
let _idCounter = 0;

function process(msg: SidecarMessage): ChatPart | null {
  const definition = resolve(msg);

  // Hidden parts return null. The caller (claude-process.ts) handles
  // side effects for specific hidden types before discarding:
  // - result/init: intercepted before process() is called
  // - tool_result: process() returns null, caller dispatches merge event
  if (definition.placement === 'hidden') return null;

  const kind = resolveKind(msg);
  const data = definition.parse(msg);

  return {
    id: `${msg.type}-${_idCounter++}`,
    kind,
    placement: definition.placement,
    timestamp: Date.now(),
    data,
    raw: msg,
  };
}

function resolveKind(msg: SidecarMessage): string {
  if (msg.type === 'tool_use' && msg.toolName) {
    const overrideKey = `tool:${msg.toolName}`;
    if (registry[overrideKey]) return overrideKey;
  }
  return msg.type;
}

// Reset counter when a new session starts (called from sessions store)
function resetIdCounter(): void { _idCounter = 0; }
```

### Parser Output Shapes (data field)

Each parser extracts specific fields from the `SidecarMessage` into the `data` field of `ChatPart`. These are the contracts that widgets consume:

#### Conversation

```typescript
// assistant
{ content: string, usage?: { inputTokens: number, outputTokens: number } }

// assistant (thinking)
{ content: string, thinking: true }

// assistant (streaming)
{ content: string, streaming: true }

// user
{ content: string, images?: ImageAttachment[] }

// tool_use
{ toolName: string, toolInput: Record<string, unknown>, toolUseId: string, toolResult?: string }

// tool_confirmation
{ toolName: string, toolInput: Record<string, unknown>, toolUseId: string }

// tool_result (intermediate — merged into tool_use, never rendered directly)
{ toolUseId: string, content: string }

// error
{ message: string, retryAfter?: number }
```

#### Tool Overrides

```typescript
// tool:AskUserQuestion
{ question: string, options: string[], toolUseId: string }

// tool:TodoWrite
{ todos: Array<{ content: string, status: string }> }
```

#### Hooks

```typescript
// hook_started
{ hookId: string, hookName: string, hookEvent: string }

// hook_progress
{ hookId: string, hookName: string, hookEvent: string, stdout: string, stderr: string, output: string }

// hook_response
{ hookId: string, hookName: string, hookEvent: string, output: string, exitCode?: number, outcome: string }
```

#### Progress

```typescript
// task_started
{ taskId: string, description: string, taskType?: string }

// task_progress
{ taskId: string, description: string, lastToolName?: string, summary?: string }

// task_notification
{ taskId: string, content: string }

// status
{ status: string, permissionMode?: string }

// tool_progress
{ toolUseId: string, toolName: string, elapsedSeconds: number }
```

#### Informational

```typescript
// local_command_output
{ content: string }

// prompt_suggestion
{ suggestion: string }

// rate_limit_event
{ rateLimitInfo: Record<string, unknown> }

// auth_status
{ isAuthenticating: boolean, output: string[], error?: string }

// tool_use_summary
{ summary: string, precedingToolUseIds: string[] }

// compact_boundary (extracted from compactMetadata object)
{ trigger: string, preTokens: number }
// The sidecar emits compactMetadata as an object: { trigger, pre_tokens, ... }
// The parser extracts and normalizes: compactMetadata.trigger -> trigger, compactMetadata.pre_tokens -> preTokens

// files_persisted
{ files: Array<{ filename: string, fileId: string }>, failed: Array<{ filename: string, error: string }> }

// elicitation_complete
{ mcpServerName: string, elicitationId: string }
```

#### Internal

```typescript
// result (handled before process(), not rendered)
{ sessionId: string, costUsd?: number, durationMs?: number, usage?: { inputTokens: number, outputTokens: number } }

// init (handled before process(), not rendered)
{ sessionId: string, gitBranch?: string, model?: string, worktreePath?: string, worktreeBranch?: string }
```

#### Fallback

```typescript
// _default (unknown types)
// data = entire SidecarMessage as-is
```

### Complete Registry Table

#### Conversation Messages

| Key | Placement | Component | Verbosity |
|-----|-----------|-----------|-----------|
| `assistant` | inline | `MarkdownContent` | quiet |
| `user` | inline | `UserMessageBlock` | quiet |
| `tool_use` | inline | `ToolCallBlock` | quiet |
| `tool_confirmation` | action-bar | `ToolApprovalBar` | quiet |
| `tool_result` | hidden | null | quiet |
| `error` | inline | `ErrorNotice` | quiet |

Note: `user` uses `UserMessageBlock` (new), not `null`. `UserMessageBlock` renders plain text with optional image attachments — preserving current behavior. Using `null` (which maps to `GenericMessageBlock`) would be a regression.

Note: `tool_result` is `hidden` because it is not rendered directly. The store merges it into the matching `tool_use` ChatPart's `data.toolResult` field.

#### Tool Overrides

| Key | Placement | Component | Verbosity |
|-----|-----------|-----------|-----------|
| `tool:AskUserQuestion` | action-bar | `UserQuestionBar` | quiet |
| `tool:TodoWrite` | header | `TaskListDisplay` | quiet |

#### Hooks

| Key | Placement | Component | Verbosity |
|-----|-----------|-----------|-----------|
| `hook_started` | inline | `HookActivityBlock` | verbose |
| `hook_progress` | inline | `HookActivityBlock` | verbose |
| `hook_response` | inline | `HookActivityBlock` | verbose |

#### Progress and Status

| Key | Placement | Component | Verbosity |
|-----|-----------|-----------|-----------|
| `task_started` | progress | null | quiet |
| `task_progress` | progress | null | quiet |
| `task_notification` | progress | null | quiet |
| `status` | progress | null | quiet |
| `tool_progress` | progress | null | quiet |

#### Informational

| Key | Placement | Component | Verbosity |
|-----|-----------|-----------|-----------|
| `local_command_output` | inline | null | normal |
| `prompt_suggestion` | action-bar | `PromptSuggestionBar` | normal |
| `rate_limit_event` | inline | `RateLimitNotice` | normal |
| `auth_status` | inline | null | normal |
| `tool_use_summary` | inline | null | normal |
| `compact_boundary` | inline | null | verbose |
| `files_persisted` | inline | null | verbose |
| `elicitation_complete` | inline | null | verbose |

#### Internal (processed but not displayed)

| Key | Placement | Component | Verbosity |
|-----|-----------|-----------|-----------|
| `result` | hidden | null | quiet |
| `init` | hidden | null | quiet |

#### Fallback

| Key | Placement | Component | Verbosity |
|-----|-----------|-----------|-----------|
| `_default` | inline | `GenericMessageBlock` | verbose |

## Streaming and Tool Result Handling

### Streaming Tokens

Streaming assistant messages (`{ type: "assistant", subtype: "streaming", content: "<delta>" }`) require special handling because they arrive at 10-20 tokens/second. Creating a new ChatPart per token would be catastrophically expensive.

The streaming flow:

1. `claude-process.ts` receives a streaming message. Instead of calling `registry.process()`, it dispatches a special `streaming-delta` event to the store.
2. The sessions store uses the existing RAF-based buffering pattern:
   - First streaming delta: creates a new `ChatPart` with `kind: 'assistant'`, `data: { content: '', streaming: true }`.
   - Subsequent deltas: buffer the text and flush via `requestAnimationFrame`, appending to the existing ChatPart's `data.content`.
3. When the final `assistant` message arrives (no `streaming` subtype), the store replaces the streaming ChatPart with the final one produced by `registry.process()`.

This is functionally identical to the current `_bufferStreamingToken` / `_flushStreamingBuffer` pattern in `sessions.ts`, but operating on `ChatPart.data.content` instead of `StreamMessage.content`.

### Detection of streaming messages

`claude-process.ts` checks `msg.type === 'assistant' && msg.subtype === 'streaming'` before calling `registry.process()`. This is the only special-case outside the registry — justified because streaming is a performance-critical path that cannot go through the normal ChatPart creation flow.

### Tool Result Merging

`tool_result` messages are handled by the sessions store, not by rendering:

1. `claude-process.ts` calls `registry.process()` for a `tool_result` message. The registry returns `null` (placement: hidden).
2. Before discarding, `claude-process.ts` dispatches the raw message to the store as a `tool-result-merge` event.
3. The store iterates backwards through the card's `ChatPart[]` to find the `tool_use` ChatPart with matching `toolUseId`, and sets `data.toolResult = content`.

This preserves the current merge pattern from `sessions.ts` lines 96-106.

### Result and Init Handling

`result` and `init` messages are intercepted by `claude-process.ts` before calling `registry.process()`:

- **`result`**: extract metrics (costUsd, durationMs, usage), call `markQueryComplete()`, update card state. Do not create a ChatPart.
- **`init`**: extract sessionId, gitBranch, worktree info. Update card and session config. Do not create a ChatPart.

This is identical to the current handling in `sessions.ts` `setupMessageListener()`, but moved to `claude-process.ts` since it operates on raw `SidecarMessage` before ChatPart conversion.

## ChatPanel Zones

### Layout

```
+---------------------------------------+
| Chat Header (title, metrics)          |
+---------------------------------------+
| Header Zone                           |  <-- placement: 'header'
| (TaskListDisplay, future headers)     |
+---------------------------------------+
|                                       |
| Inline Zone (scrollable)              |  <-- placement: 'inline'
| (messages, tools, hooks, etc.)        |
|                                       |
+---------------------------------------+
| Progress Bar                          |  <-- placement: 'progress'
+---------------------------------------+
| Action Bar Zone (FIFO queue)          |  <-- placement: 'action-bar'
| (tool approval, questions, etc.)      |
+---------------------------------------+
| Input (UChatPrompt)                   |
+---------------------------------------+
```

### useChatParts Composable

```typescript
function useChatParts(cardId: string) {
  // Returns reactive filtered lists
  return { headerParts, inlineParts, actionBarParts, progressParts };
}
```

- Filters by `placement`
- Applies current verbosity level from `SessionConfig`
- For action-bar: exposes only the oldest unresolved part (`resolved !== true`). FIFO queue.
- Resolved action-bar parts (`resolved === true`) are included in `inlineParts` as historical records.
- For header: deduplicates by `kind` — only the latest ChatPart per kind is exposed. For `tool:TodoWrite`, this means only the last TodoWrite state is shown. The `TaskListDisplay` component no longer needs to scan all messages internally.

### Action Bar Behavior

- **FIFO queue**: shows the oldest pending action. When resolved, the next one appears.
- **Resolution flow**:
  1. User clicks Allow/Deny on `ToolApprovalBar`, or selects an option on `UserQuestionBar`.
  2. The widget calls `sessionsStore.resolveActionPart(cardId, partId)`.
  3. The store sets `part.resolved = true` on the ChatPart.
  4. For tool approval: also calls `sendReply(cardId, 'allow'|'deny')` to notify the sidecar.
  5. For AskUserQuestion: sends the selected option as a user message reply.
  6. `useChatParts` reactively moves the resolved part from `actionBarParts` to `inlineParts`.
- **Only one visible at a time**: prevents cognitive overload.

### Verbosity Levels

Three levels configurable per session in `SessionConfig`:

| Level | Shows |
|-------|-------|
| `quiet` | Only messages with verbosity `quiet` (conversation, errors, essential actions) |
| `normal` | `quiet` + `normal` (adds informational messages like rate limits, command output) |
| `verbose` | Everything (adds hooks, compact boundaries, file persistence events, unknown types) |

Default: `normal`.

## Compatibility with UChatMessages

`ChatPanel.vue` uses `UChatMessages` from Nuxt UI, which expects Vercel AI SDK's `UIMessage[]` format. The `useUIMessages(inlineParts)` composable handles this conversion.

### Grouping Logic

`UChatMessages` expects messages grouped into "turns" — a single `UIMessage` with `role: 'assistant'` containing multiple parts (text, tool invocations, reasoning). The composable must:

1. **Group consecutive assistant-role ChatParts** into single UIMessages. Assistant-role parts are: `assistant`, `tool_use`, `tool_confirmation` (resolved), and any tool override that resolved from action-bar.
2. **Map ChatPart kinds to UIMessage part types**:
   - `assistant` (no thinking) → `{ type: 'text', text: data.content, state: data.streaming ? 'streaming' : 'done' }`
   - `assistant` (thinking) → `{ type: 'reasoning', reasoning: data.content }`
   - `tool_use` → `{ type: 'dynamic-tool', toolName: data.toolName, toolCallId: data.toolUseId, state: data.toolResult ? 'output-available' : 'input-available', input: data.toolInput, output: data.toolResult }`
   - `user` → `{ type: 'text', text: data.content }` (plus image parts if present)
   - `error`, hooks, informational → `{ type: 'text', text: ... }` within a system UIMessage
3. **Non-conversation parts** (hooks, errors, informational) become system-role UIMessages with a single text part. Their dedicated component is resolved via the `#content` slot in ChatPanel, not via the UIMessage type system.

This is comparable in complexity to the current `toUIMessages()` but cleaner because:
- Each ChatPart has a single known `kind` with typed `data`, vs the current `StreamMessage` where you check `type` + `subtype` + `toolName` combinations.
- The grouping boundary is clearer: a new `user` ChatPart always starts a new group.

## Component Prop Interface

All dynamically resolved components receive a single `part: ChatPart` prop. This is the universal interface — every widget accesses its data via `props.part.data`. Components that need to trigger actions (e.g., ToolApprovalBar calling `resolveActionPart`) also receive `cardId: string`.

```typescript
// Universal props for all registry-resolved components
defineProps<{
  part: ChatPart;
  cardId: string;
}>();
```

Components extract their typed data from `props.part.data`. For example, `ToolApprovalBar` reads `props.part.data.toolName`, `props.part.data.toolInput`, etc.

## Chat Status

The current `toChatStatus()` from `message-adapter.ts` is replaced by a computed in `useChatParts`:

```typescript
const chatStatus = computed(() => {
  if (!isActive) return 'ready';
  const lastInline = inlineParts.value[inlineParts.value.length - 1];
  if (lastInline?.kind === 'assistant' && lastInline.data.streaming) return 'streaming';
  return 'submitted';
});
```

This is exposed alongside the zone lists from `useChatParts`.

## New Vue Components

### GenericMessageBlock

Fallback widget for any type without a dedicated component. Renders the message kind and key data fields in a readable format. Never displays raw JSON.

- Shows the `kind` as a muted label
- Extracts and displays key-value pairs from `data` in pill/tag format
- Truncates long values with expandable detail

### UserMessageBlock

Widget for user messages. Renders plain text with optional image attachments.

- Shows text with `white-space: pre-wrap`
- Renders attached images as thumbnails below the text
- Preserves current user message styling

### ToolApprovalBar

Replaces the inline approval buttons currently in `ToolCallBlock`. Displayed in the action-bar zone.

- Shows tool name and a summary of the input (file path, command, etc.)
- Two buttons: Allow (UButton success) and Deny (UButton ghost)
- On resolution, moves to inline zone as a compact historical record

### UserQuestionBar

Widget for `AskUserQuestion` tool calls. Displayed in the action-bar zone.

- Shows the question text from `data.question`
- Renders `data.options` as clickable UButton chips
- Clicking an option sends the reply and calls `resolveActionPart()`
- If no predefined options, falls back to a text input

### PromptSuggestionBar

Widget for `prompt_suggestion` messages. Displayed in the action-bar zone.

- Shows suggested prompt as a clickable chip
- Clicking fills the input field with the suggestion
- Dismiss button to ignore (marks as resolved)

### HookActivityBlock

Inline widget for hook lifecycle events (`hook_started`, `hook_progress`, `hook_response`).

- Compact single-line display: icon + hook name + event type + status badge
- Groups consecutive hooks with the same `hookEvent` into a collapsible block (e.g., "3 hooks - PreToolUse - done")
- Status badges: running (UBadge accent), success (UBadge success), error (UBadge error)

### ErrorNotice

Inline widget for error messages.

- Red-tinted background with UIcon warning
- Shows error message text
- Optional retry action if `retryAfter` is present

### RateLimitNotice

Inline widget for rate limit events.

- Yellow/amber-tinted background with UIcon timer
- Shows rate limit message
- Countdown timer if retry-after info is available in rateLimitInfo

## Files Changed

### Modified

| File | Change |
|------|--------|
| `src-sidecar/agent-bridge.ts` | Rewrite `translateMessage()` with explicit handlers for all SDK types |
| `app/types/index.ts` | Replace `StreamMessage` and `AgentProgressEvent` with `ChatPart`, `SidecarMessage`, `VerbosityLevel`. Add `verbosity` to `SessionConfig`. |
| `app/services/claude-process.ts` | Replace dual-dispatch (message vs progress) with unified ChatPart flow. Call `registry.process()`. Handle streaming, result, init, and tool_result as special cases before registry. Remove imports of `parseStreamLine`, `isProgressEvent`, `parseProgressEvent`. Remove `progressCallbacks` map and `onProgress`/`offProgress`/`dispatchProgress` functions (progress is now handled via ChatPart with `placement: 'progress'`). Update `loadHistoryViaSidecar` to return `ChatPart[]` via registry. |
| `app/stores/sessions.ts` | Store `ChatPart[]` instead of `StreamMessage[]`. Update streaming buffer to operate on `ChatPart.data.content`. Update tool result merging to operate on ChatPart. Add `resolveActionPart()` method. Remove `AgentProgressEvent` tracking (absorbed into ChatPart). |
| `app/components/ChatPanel.vue` | Render by zones using `useChatParts`. Dynamic component resolution via registry. Add action-bar zone between progress bar and input. |
| `app/components/ToolCallBlock.vue` | Remove approval buttons (moved to `ToolApprovalBar`). Accept `ChatPart` prop instead of `StreamMessage`. |
| `app/components/TaskListDisplay.vue` | Accept `ChatPart[]` props instead of `StreamMessage[]`. Simplify — no longer needs to scan all messages for latest TodoWrite. |
| `app/components/AgentProgressBar.vue` | Accept `ChatPart[]` props instead of `AgentProgressEvent[]`. |
| `app/components/MarkdownContent.vue` | Update prop interface: accept `part: ChatPart` instead of `text`+`streaming` props. Extracts `data.content` and `data.streaming` internally. |

### New

| File | Purpose |
|------|---------|
| `app/services/chat-part-registry.ts` | Registry definitions, resolve/process/resetIdCounter functions |
| `app/composables/useChatParts.ts` | Composable that filters ChatPart[] by placement and verbosity |
| `app/composables/useUIMessages.ts` | Convert inline ChatPart[] to UIMessage[] for UChatMessages |
| `app/components/GenericMessageBlock.vue` | Fallback widget for types without dedicated components |
| `app/components/UserMessageBlock.vue` | User message with text + image support |
| `app/components/ToolApprovalBar.vue` | Tool approval in action-bar |
| `app/components/UserQuestionBar.vue` | AskUserQuestion in action-bar |
| `app/components/PromptSuggestionBar.vue` | Prompt suggestion in action-bar |
| `app/components/HookActivityBlock.vue` | Hook lifecycle display |
| `app/components/ErrorNotice.vue` | Error display |
| `app/components/RateLimitNotice.vue` | Rate limit display |

### Deleted

| File | Reason |
|------|--------|
| `app/services/message-adapter.ts` | Replaced by registry + useUIMessages composable |
| `app/services/stream-parser.ts` | Replaced by registry (JSON.parse moves to claude-process.ts) |
| `app/components/ChatMessage.vue` | Unused — ChatPanel uses UChatMessages, not ChatMessage directly. Verify no imports exist before deletion. |

## Migration Notes

- The sidecar binary must be rebuilt after changes to `agent-bridge.ts`.
- Session history loaded via `loadHistoryViaSidecar` will return `ChatPart[]` instead of `StreamMessage[]`. The sidecar's `loadHistory` command uses the same `translateMessage()`, and `claude-process.ts` will process history messages through the registry.
- No database schema changes required. Messages are ephemeral (in-memory + session JSONL files managed by the SDK).
- The `SessionConfig.verbosity` field defaults to `'normal'` in `getSessionConfig()` — no migration needed for existing sessions.
