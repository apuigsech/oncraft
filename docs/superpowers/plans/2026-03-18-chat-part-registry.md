# Chat Part Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OnCraft's ad-hoc message pipeline with a structured ChatPartRegistry that routes every SDK message type to the correct widget and placement zone, eliminating raw JSON in the chat.

**Architecture:** Sidecar normalizes SDK messages (preserving original types), frontend registry maps each type to a parser/placement/component/verbosity. Four rendering zones in ChatPanel: header, inline, action-bar (FIFO queue for user interactions), progress bar.

**Tech Stack:** TypeScript, Vue 3, Nuxt 4, Nuxt UI v4, Pinia, Bun (sidecar), Tauri v2

**Spec:** `docs/superpowers/specs/2026-03-18-chat-part-registry-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `app/types/chat-part.ts` | `ChatPart`, `SidecarMessage`, `VerbosityLevel`, `ChatPartDefinition` types |
| `app/services/chat-part-registry.ts` | Registry map, `resolve()`, `process()`, `resetIdCounter()` |
| `app/composables/useChatParts.ts` | Filter ChatPart[] by placement + verbosity, expose zone lists + chatStatus |
| `app/composables/useUIMessages.ts` | Convert inline ChatPart[] to UIMessage[] for UChatMessages |
| `app/components/GenericMessageBlock.vue` | Fallback widget: kind label + key-value pills |
| `app/components/UserMessageBlock.vue` | User text + optional image attachments |
| `app/components/ToolApprovalBar.vue` | Allow/Deny in action-bar zone |
| `app/components/UserQuestionBar.vue` | AskUserQuestion options in action-bar zone |
| `app/components/PromptSuggestionBar.vue` | Suggested prompt chip in action-bar zone |
| `app/components/HookActivityBlock.vue` | Hook lifecycle compact display |
| `app/components/ErrorNotice.vue` | Error with red styling |
| `app/components/RateLimitNotice.vue` | Rate limit with amber styling + timer |

### Modified Files

| File | Change Summary |
|------|---------------|
| `src-sidecar/agent-bridge.ts` | Rewrite `translateMessage()` — explicit handlers for all SDK types |
| `app/types/index.ts` | Remove `StreamMessage`, `AgentProgressEvent`. Add `VerbosityLevel` to `SessionConfig`. Re-export from `chat-part.ts` |
| `app/services/claude-process.ts` | Unified ChatPart dispatch. Remove progress callbacks. Handle streaming/result/init/tool_result as special cases |
| `app/stores/sessions.ts` | Store `ChatPart[]`. Update streaming buffer + tool result merge. Add `resolveActionPart()` |
| `app/components/ChatPanel.vue` | Render 4 zones via `useChatParts`. Dynamic component resolution. Action-bar zone |
| `app/components/ToolCallBlock.vue` | Remove approval buttons, accept `ChatPart` prop |
| `app/components/TaskListDisplay.vue` | Accept `ChatPart[]`, simplify (no internal message scanning) |
| `app/components/AgentProgressBar.vue` | Accept `ChatPart[]` instead of `AgentProgressEvent[]` |
| `app/components/MarkdownContent.vue` | Accept `part: ChatPart` prop instead of `text`+`streaming` |

### Deleted Files

| File | Reason |
|------|--------|
| `app/services/message-adapter.ts` | Replaced by registry + composables |
| `app/services/stream-parser.ts` | Replaced by registry (JSON.parse in claude-process.ts) |
| `app/components/ChatMessage.vue` | Unused (ChatPanel uses UChatMessages) |

---

## Task Order and Dependencies

```
Task 1: Types + Registry (foundation, no UI)
  |
  +-- Task 2: Sidecar translateMessage() rewrite (independent)
  |
  v
Task 3: claude-process.ts rewrite (needs Task 1)
  |
  v
Task 4: sessions.ts store update (needs Task 1 + 3)
  |
  v
Task 5: useChatParts + useUIMessages composables (needs Task 1 + 4)
  |
  +-- Task 6: GenericMessageBlock + UserMessageBlock (needs Task 1)
  +-- Task 7: ToolApprovalBar + UserQuestionBar (needs Task 1)
  +-- Task 8: HookActivityBlock + ErrorNotice + RateLimitNotice + PromptSuggestionBar (needs Task 1)
  |
  v
Task 9: ChatPanel.vue zone rendering (needs Task 5 + 6 + 7 + 8)
  |
  v
Task 10: Update existing components (ToolCallBlock, TaskListDisplay, AgentProgressBar, MarkdownContent)
  |
  v
Task 11: Delete old files + cleanup
  |
  v
Task 12: Sidecar rebuild + integration test
```

Tasks 2 and 6-8 can run in parallel once their dependencies are met.

---

### Task 1: Types and Chat Part Registry

**Files:**
- Create: `app/types/chat-part.ts`
- Create: `app/services/chat-part-registry.ts`
- Modify: `app/types/index.ts`

- [ ] **Step 1: Create ChatPart types**

Create `app/types/chat-part.ts`:

```typescript
export interface SidecarMessage {
  type: string;
  [key: string]: unknown;
}

export type Placement = 'header' | 'inline' | 'action-bar' | 'progress' | 'hidden';
export type VerbosityLevel = 'quiet' | 'normal' | 'verbose';

export interface ChatPart {
  id: string;
  kind: string;
  placement: Placement;
  timestamp: number;
  data: Record<string, unknown>;
  raw?: Record<string, unknown>;
  resolved?: boolean;
}

export interface ChatPartDefinition {
  parse: (raw: Record<string, unknown>) => Record<string, unknown>;
  placement: Placement;
  component: string | null;
  verbosity: VerbosityLevel;
}
```

- [ ] **Step 2: Update types/index.ts**

Remove `StreamMessage` and `AgentProgressEvent` interfaces. Add `VerbosityLevel` to `SessionConfig` (default: `'normal'`). Re-export types from `chat-part.ts`:

```typescript
export type { SidecarMessage, ChatPart, ChatPartDefinition, Placement, VerbosityLevel } from './chat-part';
```

Add to `SessionConfig`:
```typescript
verbosity: VerbosityLevel;  // add after permissionMode
```

- [ ] **Step 3: Create the registry**

Create `app/services/chat-part-registry.ts` with the complete registry map, `resolve()`, `process()`, and `resetIdCounter()` functions. The registry contains all entries from the spec table (see spec section "Complete Registry Table").

Each entry has a `parse` function that extracts the relevant fields. Examples:

```typescript
// assistant parser
parse: (raw) => ({
  content: raw.content || '',
  ...(raw.subtype === 'thinking' ? { thinking: true } : {}),
  ...(raw.subtype === 'streaming' ? { streaming: true } : {}),
  ...(raw.usage ? { usage: raw.usage } : {}),
})

// hook_started parser
parse: (raw) => ({
  hookId: raw.hookId,
  hookName: raw.hookName,
  hookEvent: raw.hookEvent,
})

// _default parser
parse: (raw) => ({ ...raw })
```

The `resolve()` function implements two-level resolution (tool:toolName override, then type, then _default). The `process()` function creates a ChatPart or returns null for hidden types.

- [ ] **Step 4: Commit**

```bash
git add app/types/chat-part.ts app/services/chat-part-registry.ts app/types/index.ts
git commit -m "feat: add ChatPart types and ChatPartRegistry"
```

---

### Task 2: Sidecar — Rewrite translateMessage()

**Files:**
- Modify: `src-sidecar/agent-bridge.ts`

This task can run in parallel with Tasks 3-8 since the sidecar is a separate binary.

- [ ] **Step 1: Add explicit handlers for all SDK message types**

Rewrite the `translateMessage()` function in `src-sidecar/agent-bridge.ts`. Keep the existing handlers for `assistant`, `user`, `result`, `system`, `stream_event` (they already work correctly). Add new handlers for all previously unhandled types:

For each type in the SDK that currently falls to the fallback, add a case. The `system` type messages with subtypes need to be split:

```typescript
if (msg.type === "system") {
  const sysMsg = msg as Record<string, unknown>;
  const subtype = sysMsg.subtype as string;

  if (subtype === "init") {
    // existing handler — keep as-is
  }
  if (subtype === "hook_started") {
    return {
      type: "hook_started",
      hookId: sysMsg.hook_id,
      hookName: sysMsg.hook_name,
      hookEvent: sysMsg.hook_event,
    };
  }
  if (subtype === "hook_progress") {
    return {
      type: "hook_progress",
      hookId: sysMsg.hook_id,
      hookName: sysMsg.hook_name,
      hookEvent: sysMsg.hook_event,
      stdout: sysMsg.stdout || "",
      stderr: sysMsg.stderr || "",
      output: sysMsg.output || "",
    };
  }
  if (subtype === "hook_response") {
    return {
      type: "hook_response",
      hookId: sysMsg.hook_id,
      hookName: sysMsg.hook_name,
      hookEvent: sysMsg.hook_event,
      output: sysMsg.output || "",
      exitCode: sysMsg.exit_code,
      outcome: sysMsg.outcome || "unknown",
    };
  }
  // ... continue for all subtypes: task_started, task_progress,
  // task_notification, status, compact_boundary, local_command_output,
  // files_persisted, elicitation_complete
}
```

Also add handlers for top-level types that bypass `system`:
```typescript
if (msg.type === "tool_progress") { ... }
if (msg.type === "auth_status") { ... }
if (msg.type === "rate_limit_event") { ... }
if (msg.type === "tool_use_summary") { ... }
if (msg.type === "prompt_suggestion") { ... }
```

- [ ] **Step 2: Replace the catch-all fallback**

Replace the current `JSON.stringify` fallback at the end of `translateMessage()`:

```typescript
// Old:
return { type: "system", subtype: ..., content: JSON.stringify(msg) };

// New:
return { type: "unknown", rawType: String((msg as Record<string, unknown>).type), data: msg };
```

- [ ] **Step 3: Commit**

```bash
git add src-sidecar/agent-bridge.ts
git commit -m "feat: sidecar translateMessage handles all SDK message types"
```

---

### Task 3: claude-process.ts — Unified ChatPart Dispatch

**Files:**
- Modify: `app/services/claude-process.ts`

- [ ] **Step 1: Update imports**

Replace:
```typescript
import type { StreamMessage, AgentProgressEvent, SessionConfig } from '~/types';
import { parseStreamLine, isProgressEvent, parseProgressEvent } from './stream-parser';
```

With:
```typescript
import type { ChatPart, SidecarMessage, SessionConfig } from '~/types';
import { process as registryProcess } from './chat-part-registry';
```

- [ ] **Step 2: Remove progress callback infrastructure**

Delete `progressCallbacks` map, `onProgress()`, `offProgress()`, `dispatchProgress()` functions. Update `messageCallbacks` type from `(msg: StreamMessage) => void` to `(part: ChatPart) => void`.

Add a new callback type for special events:
```typescript
type PartCallback = (part: ChatPart) => void;
type MetaCallback = (msg: SidecarMessage) => void;
const messageCallbacks = new Map<string, PartCallback>();
const metaCallbacks = new Map<string, MetaCallback>();
```

`metaCallbacks` handle init, result, streaming deltas, and tool_result merges — things the store needs to process differently from normal ChatParts.

- [ ] **Step 3: Rewrite the stdout data handler**

In `spawnSession()`, replace the `command.stdout.on('data', ...)` handler. The new logic for each parsed JSON line:

```typescript
const raw: SidecarMessage = JSON.parse(line);

// 1. Intercept result — extract metrics, mark query complete
if (raw.type === 'result') {
  dispatchMeta(cardId, raw);
  return;
}

// 2. Intercept init — extract sessionId, gitBranch, etc.
if (raw.type === 'init') {
  dispatchMeta(cardId, raw);
  return;
}

// 3. Intercept streaming deltas — buffer via store
if (raw.type === 'assistant' && raw.subtype === 'streaming') {
  dispatchMeta(cardId, raw);
  return;
}

// 4. Process through registry
const part = registryProcess(raw);

// 5. tool_result returns null from registry but needs merge
if (!part && raw.type === 'tool_result') {
  dispatchMeta(cardId, raw);
  return;
}

// 6. Normal ChatPart — dispatch to store
if (part) {
  dispatchMessage(cardId, part);
}
```

- [ ] **Step 4: Update loadHistoryViaSidecar**

Change return type from `StreamMessage[]` to `ChatPart[]`. Process each raw history message through the registry:

```typescript
export async function loadHistoryViaSidecar(sessionId: string): Promise<ChatPart[]> {
  const result = await _utilRequest({ cmd: 'loadHistory', sessionId }, 'history');
  const rawMessages = (result.messages as Record<string, unknown>[]) || [];
  const parts: ChatPart[] = [];
  for (const m of rawMessages) {
    const part = registryProcess(m as SidecarMessage);
    if (part) parts.push(part);
  }
  return parts;
}
```

- [ ] **Step 5: Commit**

```bash
git add app/services/claude-process.ts
git commit -m "feat: claude-process dispatches ChatParts via registry"
```

---

### Task 4: sessions.ts Store — ChatPart Storage

**Files:**
- Modify: `app/stores/sessions.ts`

- [ ] **Step 1: Update type imports and state**

Replace `StreamMessage` with `ChatPart` and `SidecarMessage` in all type annotations. Change `messages` record type from `Record<string, StreamMessage[]>` to `Record<string, ChatPart[]>`. Remove `progressEvents` record.

- [ ] **Step 2: Update streaming buffer**

Adapt `_bufferStreamingToken` and `_flushStreamingBuffer` to operate on `ChatPart.data.content` instead of `StreamMessage.content`. The buffer pattern stays the same (RAF coalescing):

```typescript
function _flushStreamingBuffer(cardId: string): void {
  const buffered = _streamingBuffers.get(cardId);
  if (!buffered) return;
  _streamingBuffers.delete(cardId);
  _streamingRafPending.delete(cardId);
  const msgs = messages[cardId];
  if (!msgs?.length) return;
  const last = msgs[msgs.length - 1];
  if (last?.kind === 'assistant' && last.data.streaming) {
    last.data.content = (last.data.content as string) + buffered;
  }
}
```

- [ ] **Step 3: Update appendMessage to appendPart**

Rename `appendMessage` to `appendPart`. Update tool result merge logic to find matching `tool_use` ChatPart by `data.toolUseId`. Update streaming replacement logic (final assistant replaces streaming ChatPart).

- [ ] **Step 4: Add handleMeta for init/result/streaming/tool_result**

Add a `handleMeta(cardId, msg: SidecarMessage)` method that handles:
- `result`: extract metrics, mark query complete, update card state
- `init`: extract sessionId, gitBranch, update card and session config
- streaming deltas: buffer token via `_bufferStreamingToken`
- `tool_result`: find matching tool_use ChatPart and set `data.toolResult`

This replaces the current logic in `setupMessageListener`.

- [ ] **Step 5: Add resolveActionPart**

```typescript
function resolveActionPart(cardId: string, partId: string): void {
  const parts = messages[cardId];
  if (!parts) return;
  const part = parts.find(p => p.id === partId);
  if (part) part.resolved = true;
}
```

- [ ] **Step 6: Update setupMessageListener**

Simplify: the callback now receives `ChatPart` directly (for normal parts) or `SidecarMessage` (for meta events). Remove all the type-checking logic that currently lives here — it's now in `claude-process.ts`.

- [ ] **Step 7: Update getSessionConfig default**

Add `verbosity: 'normal'` to the default config in `getSessionConfig()`.

- [ ] **Step 8: Commit**

```bash
git add app/stores/sessions.ts
git commit -m "feat: sessions store uses ChatPart[], handles streaming and tool result merge"
```

---

### Task 5: Composables — useChatParts + useUIMessages

**Files:**
- Create: `app/composables/useChatParts.ts`
- Create: `app/composables/useUIMessages.ts`

- [ ] **Step 1: Create useChatParts**

Create `app/composables/useChatParts.ts`:

```typescript
import type { ChatPart, VerbosityLevel } from '~/types';

const VERBOSITY_ORDER: Record<VerbosityLevel, number> = { quiet: 0, normal: 1, verbose: 2 };

export function useChatParts(cardId: Ref<string | null>) {
  const sessionsStore = useSessionsStore();

  const allParts = computed(() => {
    if (!cardId.value) return [];
    return sessionsStore.getMessages(cardId.value); // returns ChatPart[]
  });

  const verbosity = computed(() => {
    if (!cardId.value) return 'normal' as VerbosityLevel;
    return sessionsStore.getSessionConfig(cardId.value).verbosity;
  });

  const verbosityLevel = computed(() => VERBOSITY_ORDER[verbosity.value]);

  // Import registry to check verbosity per kind
  // (or store verbosity on ChatPart itself during process())

  const headerParts = computed(() => {
    // Deduplicate by kind — latest per kind only
    const byKind = new Map<string, ChatPart>();
    for (const p of allParts.value) {
      if (p.placement === 'header') byKind.set(p.kind, p);
    }
    return Array.from(byKind.values());
  });

  const inlineParts = computed(() => {
    return allParts.value.filter(p =>
      p.placement === 'inline' ||
      (p.placement === 'action-bar' && p.resolved)
    );
  });

  const actionBarParts = computed(() => {
    // FIFO: oldest unresolved
    return allParts.value.find(p =>
      p.placement === 'action-bar' && !p.resolved
    ) || null;
  });

  const progressParts = computed(() => {
    return allParts.value.filter(p => p.placement === 'progress');
  });

  const isActive = computed(() => {
    if (!cardId.value) return false;
    return sessionsStore.isActive(cardId.value);
  });

  const chatStatus = computed(() => {
    if (!isActive.value) return 'ready' as const;
    const last = inlineParts.value[inlineParts.value.length - 1];
    if (last?.kind === 'assistant' && last.data.streaming) return 'streaming' as const;
    return 'submitted' as const;
  });

  return { headerParts, inlineParts, actionBarParts, progressParts, chatStatus, allParts };
}
```

- [ ] **Step 2: Create useUIMessages**

Create `app/composables/useUIMessages.ts`. This converts inline `ChatPart[]` to the `UIMessage[]` format that `UChatMessages` expects:

- Group consecutive assistant-role parts (assistant, tool_use, resolved tool_confirmation) into single UIMessages
- Map each ChatPart kind to the appropriate UIMessage part type
- User parts start new UIMessage groups
- Non-conversation parts (hooks, errors, etc.) become system-role UIMessages

The grouping logic follows the spec section "Compatibility with UChatMessages > Grouping Logic". Define the UIMessage/UIMessagePart types inline (as the current message-adapter.ts does) to avoid importing from Vercel AI SDK.

- [ ] **Step 3: Commit**

```bash
git add app/composables/useChatParts.ts app/composables/useUIMessages.ts
git commit -m "feat: add useChatParts and useUIMessages composables"
```

---

### Task 6: GenericMessageBlock + UserMessageBlock

**Files:**
- Create: `app/components/GenericMessageBlock.vue`
- Create: `app/components/UserMessageBlock.vue`

- [ ] **Step 1: Create GenericMessageBlock**

Create `app/components/GenericMessageBlock.vue`. Props: `part: ChatPart`, `cardId: string`.

Renders:
- `part.kind` as a muted monospace label
- Iterates `Object.entries(part.data)`, skipping internal keys, displaying each as a key-value pill
- Long string values truncated to 100 chars with expandable toggle
- Uses Nuxt UI: `UBadge` for the kind label

- [ ] **Step 2: Create UserMessageBlock**

Create `app/components/UserMessageBlock.vue`. Props: `part: ChatPart`, `cardId: string`.

Renders:
- `part.data.content` as plain text with `white-space: pre-wrap`
- If `part.data.images` exists, render each image as `<img>` with `max-width: 300px`, same styling as current ChatPanel image rendering

- [ ] **Step 3: Commit**

```bash
git add app/components/GenericMessageBlock.vue app/components/UserMessageBlock.vue
git commit -m "feat: add GenericMessageBlock and UserMessageBlock components"
```

---

### Task 7: ToolApprovalBar + UserQuestionBar

**Files:**
- Create: `app/components/ToolApprovalBar.vue`
- Create: `app/components/UserQuestionBar.vue`

- [ ] **Step 1: Create ToolApprovalBar**

Create `app/components/ToolApprovalBar.vue`. Props: `part: ChatPart`, `cardId: string`.

Reads from `part.data`: `toolName`, `toolInput`, `toolUseId`.

Renders:
- Tool name (bold) + summary of input (file path for Read/Write/Edit, command for Bash, pattern for Glob/Grep — reuse the summary logic from current `ToolCallBlock.vue`)
- `UButton` "Allow" (color success) and `UButton` "Deny" (variant ghost)
- On Allow: call `sessionsStore.approveToolUse(cardId)` then `sessionsStore.resolveActionPart(cardId, part.id)`
- On Deny: call `sessionsStore.rejectToolUse(cardId)` then `sessionsStore.resolveActionPart(cardId, part.id)`
- Border color: warning (amber) to draw attention

- [ ] **Step 2: Create UserQuestionBar**

Create `app/components/UserQuestionBar.vue`. Props: `part: ChatPart`, `cardId: string`.

Reads from `part.data`: `question`, `options`, `toolUseId`.

Renders:
- Question text
- Each option as a `UButton` (variant outline, size sm)
- Clicking an option: call `sessionsStore.send(cardId, selectedOption)` then `sessionsStore.resolveActionPart(cardId, part.id)`
- If `options` is empty or missing, show a text input with submit button
- Border color: accent (purple)

- [ ] **Step 3: Commit**

```bash
git add app/components/ToolApprovalBar.vue app/components/UserQuestionBar.vue
git commit -m "feat: add ToolApprovalBar and UserQuestionBar for action-bar zone"
```

---

### Task 8: HookActivityBlock + ErrorNotice + RateLimitNotice + PromptSuggestionBar

**Files:**
- Create: `app/components/HookActivityBlock.vue`
- Create: `app/components/ErrorNotice.vue`
- Create: `app/components/RateLimitNotice.vue`
- Create: `app/components/PromptSuggestionBar.vue`

- [ ] **Step 1: Create HookActivityBlock**

Create `app/components/HookActivityBlock.vue`. Props: `part: ChatPart`, `cardId: string`.

Reads from `part.data`: `hookId`, `hookName`, `hookEvent`, and optionally `outcome`, `output`, `exitCode`.

Renders a compact single-line block:
- Gear icon (UIcon `i-lucide-settings`)
- Hook name (bold)
- Hook event (muted monospace)
- Status badge: `UBadge` — "running" for hook_started, "success"/"error" for hook_response based on `outcome`
- Expandable detail section showing `output`/`stdout`/`stderr` if present

- [ ] **Step 2: Create ErrorNotice**

Create `app/components/ErrorNotice.vue`. Props: `part: ChatPart`, `cardId: string`.

Reads from `part.data`: `message`, `retryAfter`.

Renders:
- Red-tinted background (`bg-error/10`)
- `UIcon` `i-lucide-alert-triangle`
- Error message text
- If `retryAfter`: show "Retrying in {n}s..."

- [ ] **Step 3: Create RateLimitNotice**

Create `app/components/RateLimitNotice.vue`. Props: `part: ChatPart`, `cardId: string`.

Reads from `part.data`: `rateLimitInfo`.

Renders:
- Amber-tinted background (`bg-warning/10`)
- `UIcon` `i-lucide-clock`
- "Rate limited" text
- If rateLimitInfo has timing data, show countdown

- [ ] **Step 4: Create PromptSuggestionBar**

Create `app/components/PromptSuggestionBar.vue`. Props: `part: ChatPart`, `cardId: string`.

Reads from `part.data`: `suggestion`.

Renders:
- "Suggested:" label
- Suggestion text as a clickable `UButton` chip (variant outline, rounded)
- Clicking fills the chat input with the suggestion text
- Dismiss X button that calls `sessionsStore.resolveActionPart(cardId, part.id)`

- [ ] **Step 5: Commit**

```bash
git add app/components/HookActivityBlock.vue app/components/ErrorNotice.vue app/components/RateLimitNotice.vue app/components/PromptSuggestionBar.vue
git commit -m "feat: add HookActivityBlock, ErrorNotice, RateLimitNotice, PromptSuggestionBar"
```

---

### Task 9: ChatPanel.vue — Zone Rendering

**Files:**
- Modify: `app/components/ChatPanel.vue`

- [ ] **Step 1: Replace imports and data sources**

Remove imports of `toUIMessages`, `toChatStatus` from `message-adapter.ts`. Replace with `useChatParts` and `useUIMessages` composables:

```typescript
const { headerParts, inlineParts, actionBarParts, progressParts, chatStatus } = useChatParts(
  computed(() => sessionsStore.activeChatCardId)
);
const uiMessages = useUIMessages(inlineParts);
```

- [ ] **Step 2: Add action-bar zone to template**

Between the progress area and `UChatPrompt`, add the action-bar zone:

```vue
<!-- Action Bar Zone — shows one pending action at a time -->
<div v-if="actionBarParts" class="action-bar-zone">
  <component
    :is="resolveComponent(actionBarParts.kind)"
    :part="actionBarParts"
    :card-id="sessionsStore.activeChatCardId!"
  />
</div>
```

- [ ] **Step 3: Update header zone**

Replace the current `<TaskListDisplay>` with dynamic header rendering:

```vue
<template v-for="part in headerParts" :key="part.id">
  <component
    :is="resolveComponent(part.kind)"
    :part="part"
    :card-id="sessionsStore.activeChatCardId!"
  />
</template>
```

- [ ] **Step 4: Add resolveComponent helper**

Import the registry and create a component resolution function:

```typescript
import { resolve as registryResolve } from '~/services/chat-part-registry';

function resolveComponent(kind: string) {
  // Use defineAsyncComponent or resolveComponent from Vue
  // Map component name strings to actual components
  const componentMap: Record<string, Component> = {
    GenericMessageBlock,
    UserMessageBlock,
    ToolCallBlock,
    ToolApprovalBar,
    UserQuestionBar,
    // ... all registered components
  };
  const def = registryResolve({ type: kind } as any);
  return componentMap[def.component || 'GenericMessageBlock'] || GenericMessageBlock;
}
```

Note: Since Nuxt auto-imports components, we can also use `resolveComponent()` from Vue's runtime.

- [ ] **Step 5: Update UChatMessages #content slot**

Update the `#content` template slot to use `ChatPart` data instead of the old UIMessagePart types. The dynamic-tool parts now resolve their component from the registry. Non-tool parts (text, reasoning) continue using `MarkdownContent` and thinking block rendering.

- [ ] **Step 6: Update progress bar**

Pass `progressParts` to `AgentProgressBar`:

```vue
<AgentProgressBar :parts="progressParts" :is-active="isActive" />
```

- [ ] **Step 7: Commit**

```bash
git add app/components/ChatPanel.vue
git commit -m "feat: ChatPanel renders 4 zones via useChatParts"
```

---

### Task 10: Update Existing Components

**Files:**
- Modify: `app/components/ToolCallBlock.vue`
- Modify: `app/components/TaskListDisplay.vue`
- Modify: `app/components/AgentProgressBar.vue`
- Modify: `app/components/MarkdownContent.vue`

- [ ] **Step 1: Update ToolCallBlock.vue**

Change props from `message: StreamMessage` to `part: ChatPart, cardId: string`. Read tool data from `props.part.data` instead of `props.message`. Remove the approval buttons section (`tool-confirm` div with Allow/Deny) — approval is now in `ToolApprovalBar`.

- [ ] **Step 2: Update TaskListDisplay.vue**

Change props from `messages: StreamMessage[]` to accept a single `part: ChatPart`. Read `part.data.todos` directly instead of scanning all messages for the latest TodoWrite call. The `useChatParts` composable already deduplicates header parts, so the component receives only the latest state.

- [ ] **Step 3: Update AgentProgressBar.vue**

Change props from `events: AgentProgressEvent[]` to `parts: ChatPart[]`. Extract `content` from `part.data.description || part.data.content || part.data.status || part.kind`. Use the last part for display.

- [ ] **Step 4: Update MarkdownContent.vue**

Change props from `text: string, streaming?: boolean` to `part: ChatPart, cardId: string`. Extract text and streaming state from `part.data`:

```typescript
const props = defineProps<{ part: ChatPart; cardId: string }>();
const text = computed(() => (props.part.data.content as string) || '');
const streaming = computed(() => !!props.part.data.streaming);
```

Internal logic (debounced markdown, rendered HTML) stays the same, just reads from the new source.

- [ ] **Step 5: Commit**

```bash
git add app/components/ToolCallBlock.vue app/components/TaskListDisplay.vue app/components/AgentProgressBar.vue app/components/MarkdownContent.vue
git commit -m "refactor: update existing components to accept ChatPart props"
```

---

### Task 11: Delete Old Files + Cleanup

**Files:**
- Delete: `app/services/message-adapter.ts`
- Delete: `app/services/stream-parser.ts`
- Delete: `app/components/ChatMessage.vue`

- [ ] **Step 1: Verify no remaining imports**

Search for imports of the files to be deleted:

```bash
grep -r "message-adapter\|stream-parser\|ChatMessage" app/ --include="*.ts" --include="*.vue" -l
```

Fix any remaining references. At this point, `stream-parser.ts` should have no imports (claude-process.ts was updated in Task 3). `message-adapter.ts` should have no imports (ChatPanel.vue was updated in Task 9). `ChatMessage.vue` should have no imports (it was already unused).

- [ ] **Step 2: Delete the files**

```bash
rm app/services/message-adapter.ts app/services/stream-parser.ts app/components/ChatMessage.vue
```

- [ ] **Step 3: Verify build compiles**

```bash
pnpm dev
```

Check that the Nuxt dev server starts without TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove message-adapter, stream-parser, ChatMessage (replaced by registry)"
```

---

### Task 12: Sidecar Rebuild + Integration Verification

**Files:**
- Rebuild: `src-sidecar/agent-bridge.ts` → `src-tauri/binaries/agent-bridge-*`

- [ ] **Step 1: Rebuild the sidecar binary**

```bash
pnpm build:sidecar
```

Verify the binary is produced at `src-tauri/binaries/agent-bridge-$(rustc -vV | sed -n 's/host: //p')`.

- [ ] **Step 2: Run the full app**

```bash
pnpm tauri dev
```

- [ ] **Step 3: Manual integration verification**

Open the app, select a project, open or create a card, start a chat session. Verify:

1. **Assistant text** renders with markdown formatting (not raw JSON)
2. **Tool calls** (Read, Bash, etc.) show in the inline zone with the ToolCallBlock widget
3. **Tool approval** prompts appear in the action-bar zone (below progress, above input)
4. **If hooks fire**, they appear as compact inline blocks (if verbosity is set to verbose)
5. **Tasks** (TodoWrite) appear in the header zone
6. **Errors** show with red styling via ErrorNotice
7. **No raw JSON** appears in the chat for any message type
8. **Unknown message types** render with GenericMessageBlock (kind label + pills)

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration fixes from manual testing"
```

---

## Summary

| Task | Description | Dependencies | Est. Steps |
|------|-------------|-------------|------------|
| 1 | Types + Registry | None | 4 |
| 2 | Sidecar translateMessage rewrite | None | 3 |
| 3 | claude-process.ts unified dispatch | Task 1 | 5 |
| 4 | sessions.ts store update | Task 1, 3 | 8 |
| 5 | useChatParts + useUIMessages | Task 1, 4 | 3 |
| 6 | GenericMessageBlock + UserMessageBlock | Task 1 | 3 |
| 7 | ToolApprovalBar + UserQuestionBar | Task 1 | 3 |
| 8 | Hook/Error/RateLimit/Suggestion widgets | Task 1 | 5 |
| 9 | ChatPanel zone rendering | Task 5, 6, 7, 8 | 7 |
| 10 | Update existing components | Task 1 | 5 |
| 11 | Delete old files + cleanup | Task 9, 10 | 4 |
| 12 | Sidecar rebuild + integration test | Task 2, 11 | 4 |
