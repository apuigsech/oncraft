# Chat UX: Synthetic Messages & Subagent Separation

## Problem

The integrated chat currently has two UX issues:

1. **Synthetic messages look like user messages.** When the SDK emits `user` type messages that were not written by the user (skill prompts, subagent prompts, system-reminders injected by hooks), they render as `UserMessageBlock` — indistinguishable from real user input. This clutters the chat with large blocks of internal text.

2. **Subagent messages are mixed into the main stream.** All messages from all agents (main + subagents) appear in a single flat timeline. There is no way to tell which agent produced which message, making it hard to follow what each subagent is doing.

## SDK Fields Available

The Claude Agent SDK already provides the metadata needed to solve both problems:

| Field | Present on | Values |
|---|---|---|
| `isSynthetic` | `SDKUserMessage` | `true` = generated internally (not user-written) |
| `parent_tool_use_id` | `SDKAssistantMessage`, `SDKUserMessage`, `SDKPartialAssistantMessage`, `SDKToolProgressMessage` | `null` = main agent; `"toolu_xxx"` = belongs to the subagent spawned by that tool_use |

The sidecar (`agent-bridge.ts`) currently discards both fields when translating messages.

## Design

### 1. Propagate metadata through the sidecar

In `agent-bridge.ts` `translateMessage()`, add `isSynthetic` and `parentToolUseId` to every translated message that has them on the SDK source object:

- `user` messages: propagate `msg.isSynthetic` and `msg.parent_tool_use_id`
- `assistant` messages (from content blocks): propagate `msg.parent_tool_use_id`
- `stream_event` messages: propagate `msg.parent_tool_use_id`
- `tool_progress` messages: propagate `msg.parent_tool_use_id`

Field naming convention: camelCase on the frontend side (`isSynthetic`, `parentToolUseId`).

### 2. Synthetic messages as collapsible badges

Messages where `isSynthetic: true` and `parentToolUseId` is `null` are rendered as a `SyntheticBadge` component instead of `UserMessageBlock`.

**Visual design:**
- Left-aligned, compact width (auto-sized to content, same alignment as assistant messages, NOT centered)
- Background: `--bg-secondary` (`#24283b`)
- Border: `--bg-tertiary` (`#2f3549`), border-radius 8px
- Monospace font, 12px
- Single-line header: icon + type label + name + chevron
- Collapsed by default; click to expand and see full content
- Same visual style/sizing as other inline chat widgets (ToolCallBlock, etc.)

**Type detection from content:**
- Contains `<command-name>` tag → extract skill name → type: "Skill loaded", name: extracted skill name
- Contains `<system-reminder>` tag → type: "System", name: try to extract first meaningful line
- Otherwise → type: "Internal", name: first 40 chars of content

**Skill load fusion:** Register `tool_use:Skill` in `chat-part-registry.ts` with placement `hidden`. The synthetic `user` message that follows it becomes the single "Skill loaded" badge. The badge extracts the skill name from the preceding hidden `tool_use` (via the `skill` field in `toolInput`). This eliminates the current duplication where both a `ToolCallBlock` and the raw prompt appear.

### 3. Subagent messages as collapsible inline blocks

Messages where `parentToolUseId` is not null belong to a subagent. They are grouped inside a `SubagentBlock` component.

**Anchoring:** The block is created when a `tool_use` with `toolName: "Agent"` appears. Register `tool_use:Agent` in `chat-part-registry.ts` to render as `SubagentBlock` instead of the generic `ToolCallBlock`.

**Header (always visible):**
- Left-aligned, full width
- Left border: 3px colored by state
- LED indicator + "Agent" label + description (from `toolInput.description`) + elapsed time + token count + chevron
- Monospace font, 12px, same style as other chat widgets

**Body (collapsible):**
- Contains a mini-chat with all messages from that subagent
- Synthetic user messages inside show as italic gray line ("Prompt del subagente")
- Tool calls render as compact sub-tool widgets
- Assistant messages render as normal text
- Final result shown with "Result:" prefix at the bottom

**State colors (left border + LED):**

| State | Border color | LED |
|---|---|---|
| Running | `--warning` (`#e0af68`) | Pulsing animation |
| Completed | `--success` (`#9ece6a`) | Static |
| Error | `--error` (`#f7768e`) | Static |

**Auto-expand behavior:**
- Running → expanded by default (user can collapse manually)
- Completed → collapsed by default (user can expand)
- Error → collapsed by default

**Multiple parallel subagents:** Each subagent gets its own independent `SubagentBlock`, stacked vertically in the order they were dispatched.

### 4. Message routing logic

A new composable or extension to `useChatParts` handles routing:

```
For each incoming ChatPart:
  if part.data.parentToolUseId is not null:
    → route to the SubagentBlock with matching toolUseId
    → do NOT add to main chat stream
  else if part.kind === 'user' and part.data.isSynthetic:
    → render as SyntheticBadge
  else:
    → render normally in main chat stream
```

The `SubagentBlock` component maintains its own internal list of parts, separate from the main parts array. This keeps the main chat clean.

### 5. Registry changes

| Key | Placement | Component | Notes |
|---|---|---|---|
| `tool_use:Skill` | `hidden` | `null` | Hides the ToolCallBlock; the synthetic message becomes the badge |
| `tool_use:Agent` | `inline` | `SubagentBlock` | Replaces generic ToolCallBlock for Agent invocations |
| New: synthetic user detection | `inline` | `SyntheticBadge` | Via `isSynthetic` flag, not registry key |

## New Components

| Component | Purpose |
|---|---|
| `SyntheticBadge.vue` | Collapsible badge for synthetic user messages (skill loads, system-reminders) |
| `SubagentBlock.vue` | Collapsible block containing a subagent's entire message stream |

## Files to Modify

| File | Changes |
|---|---|
| `src-sidecar/agent-bridge.ts` | Propagate `isSynthetic` and `parentToolUseId` in `translateMessage()` |
| `app/services/chat-part-registry.ts` | Add `tool_use:Skill` (hidden) and `tool_use:Agent` (SubagentBlock) entries |
| `app/services/claude-process.ts` | Pass `isSynthetic` and `parentToolUseId` through message processing |
| `app/composables/useChatParts.ts` | Route messages by `parentToolUseId`; filter synthetics |
| `app/components/SyntheticBadge.vue` | New component |
| `app/components/SubagentBlock.vue` | New component |
| `app/components/ChatPanel.vue` | Pass subagent parts to SubagentBlock; handle synthetic badge rendering |
| `app/types/chat-part.ts` | Add optional `isSynthetic` and `parentToolUseId` to relevant types |

## Acceptance Criteria

1. Real user messages render exactly as before (no visual change)
2. Synthetic user messages (skill prompts, system-reminders) render as left-aligned collapsible badges instead of full user message blocks
3. Invoking the `Skill` tool produces a single "Skill loaded: name" badge (not a ToolCallBlock + raw prompt)
4. Subagent messages are grouped inside collapsible `SubagentBlock` widgets anchored at the Agent tool_use position
5. Running subagents show expanded with pulsing LED; completed/errored ones collapse automatically
6. Multiple parallel subagents each get their own independent block
7. Expanding a subagent block shows its full message stream (tools, assistant responses, result)
8. The main chat stream contains only main-agent messages — no subagent messages leak through
9. All existing chat functionality (streaming, tool approval, markdown rendering) continues to work unchanged

## Out of Scope

- Console mode (PTY terminal) — unaffected
- Subagent nesting (subagents of subagents) — not addressed in this iteration
- Verbosity settings for synthetic badges — future enhancement
- Filtering/searching within subagent blocks — future enhancement
