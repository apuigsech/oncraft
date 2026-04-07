# Chat UX: Synthetic Messages & Subagent Separation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Propagate `isSynthetic` and `parentToolUseId` from the SDK through the sidecar, then render synthetic messages as collapsible badges and group subagent messages into collapsible inline blocks.

**Architecture:** Bottom-up — start with the sidecar (data source), then types, then registry, then routing logic, then the two new UI components. Each task builds on the previous one and produces a committable unit.

**Tech Stack:** TypeScript (sidecar/Bun), Vue 3 + Nuxt 4 (frontend), Pinia (state), CSS custom properties (Tokyo Night theme)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src-sidecar/agent-bridge.ts` | Propagate `isSynthetic` + `parentToolUseId` in `translateMessage()` |
| `app/types/chat-part.ts` | No changes needed — `data: Record<string, unknown>` already accommodates new fields |
| `app/services/chat-part-registry.ts` | Add `tool_use:Skill` (hidden) + `tool_use:Agent` (SubagentBlock) + synthetic user handling |
| `app/services/claude-process.ts` | Pass `parentToolUseId` through streaming delta interception |
| `app/composables/useChatParts.ts` | Route subagent messages to their block; expose subagent parts map |
| `app/composables/useUIMessages.ts` | Handle synthetic user parts and subagent-block parts |
| `app/components/SyntheticBadge.vue` | Collapsible badge for synthetic messages |
| `app/components/SubagentBlock.vue` | Collapsible block grouping a subagent's message stream |
| `app/components/ChatPanel.vue` | Render SyntheticBadge and SubagentBlock via the existing template dispatch |

---

### Task 1: Propagate metadata in the sidecar

**Files:**
- Modify: `src-sidecar/agent-bridge.ts:206-287` (translateMessage, `assistant` and `user` branches)
- Modify: `src-sidecar/agent-bridge.ts:434-456` (translateMessage, `stream_event` branch)
- Modify: `src-sidecar/agent-bridge.ts:458-467` (translateMessage, `tool_progress` branch)

- [ ] **Step 1: Add parentToolUseId to assistant message translations**

In the `if (msg.type === "assistant")` branch (line 206), the function iterates over content blocks and pushes results. Add `parentToolUseId` to every pushed object. The field comes from `msg.parent_tool_use_id` on the SDK message (not from the content block).

```typescript
// In the assistant branch, after line 206:
if (msg.type === "assistant") {
    const content = msg.message?.content;
    if (!content || !Array.isArray(content)) return null;
    const parentToolUseId = (msg as Record<string, unknown>).parent_tool_use_id ?? null;

    const results: Record<string, unknown>[] = [];
    for (const block of content) {
      if (block.type === "text") {
        results.push({
          type: "assistant",
          content: block.text,
          parentToolUseId,
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
          parentToolUseId,
        });
      } else if (block.type === "thinking") {
        results.push({
          type: "assistant",
          content: (block as { thinking?: string }).thinking || "",
          subtype: "thinking",
          parentToolUseId,
        });
      }
    }
    if (results.length === 0) return null;
    return results.length === 1 ? results[0] : results;
  }
```

- [ ] **Step 2: Add isSynthetic and parentToolUseId to user message translations**

In the `if (msg.type === "user")` branch (line 242), extract both fields and add them to every result:

```typescript
  if (msg.type === "user") {
    const content = msg.message?.content;
    if (!content) return null;
    const isSynthetic = (msg as Record<string, unknown>).isSynthetic === true;
    const parentToolUseId = (msg as Record<string, unknown>).parent_tool_use_id ?? null;

    // Content can be a plain string
    if (typeof content === "string") {
      return { type: "user", content, isSynthetic, parentToolUseId };
    }

    if (!Array.isArray(content)) return null;

    const results: Record<string, unknown>[] = [];
    const images: { data: string; mediaType: string; name: string }[] = [];
    for (const block of content as Record<string, unknown>[]) {
      if (block.type === "text") {
        results.push({ type: "user", content: block.text, isSynthetic, parentToolUseId });
      } else if (block.type === "image") {
        // ... image handling unchanged ...
      } else if (block.type === "tool_result") {
        results.push({
          type: "tool_result",
          toolUseId: block.tool_use_id,
          content:
            typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content),
          parentToolUseId,
        });
      }
    }
    // Attach extracted images to the first user text message (unchanged)
    if (images.length > 0 && results.length > 0) {
      const firstUser = results.find(r => r.type === "user");
      if (firstUser) {
        firstUser.images = images;
      }
    }
    if (results.length === 0) return null;
    return results.length === 1 ? results[0] : results;
  }
```

- [ ] **Step 3: Add parentToolUseId to stream_event translations**

In the `if (msg.type === "stream_event")` branch (line 435):

```typescript
  if (msg.type === "stream_event") {
    const parentToolUseId = (msg as Record<string, unknown>).parent_tool_use_id ?? null;
    const event = (msg as Record<string, unknown>).event as Record<string, unknown> | undefined;
    if (event?.type === "content_block_delta") {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        return {
          type: "assistant",
          subtype: "streaming",
          content: delta.text,
          parentToolUseId,
        };
      }
      if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
        return {
          type: "assistant",
          subtype: "thinking_streaming",
          content: delta.thinking,
          parentToolUseId,
        };
      }
    }
    return null;
  }
```

- [ ] **Step 4: Add parentToolUseId to tool_progress translations**

In the `if (msg.type === "tool_progress")` branch (line 458):

```typescript
  if (msg.type === "tool_progress") {
    const m = msg as Record<string, unknown>;
    return {
      type: "tool_progress",
      toolUseId: m.tool_use_id,
      toolName: m.tool_name,
      elapsedSeconds: m.elapsed_time_seconds,
      taskId: m.task_id,
      parentToolUseId: m.parent_tool_use_id ?? null,
    };
  }
```

- [ ] **Step 5: Rebuild sidecar and commit**

```bash
pnpm build:sidecar
git add src-sidecar/agent-bridge.ts
git commit -m "feat(sidecar): propagate isSynthetic and parentToolUseId from SDK messages"
```

---

### Task 2: Pass parentToolUseId through streaming interception in claude-process.ts

**Files:**
- Modify: `app/services/claude-process.ts:184-188` (streaming delta interception)

The streaming delta interception in `claude-process.ts` intercepts `assistant` messages with `subtype: "streaming"` and forwards them via `dispatchMeta`. The `parentToolUseId` field needs to pass through so the store can route streaming tokens to the correct subagent.

- [ ] **Step 1: Pass parentToolUseId through streaming dispatch**

In `claude-process.ts` line 185, the streaming interception already passes the full `sidecarMsg` to `dispatchMeta`. Verify that `dispatchMeta` in `sessions.ts` preserves the field. Look at how `dispatchMeta` handles streaming messages:

The `dispatchMeta` function in `sessions.ts` (around line 260) accesses `msg.subtype` and `msg.content` for streaming. It also needs to pass `parentToolUseId` to the streaming ChatPart it creates.

In `app/stores/sessions.ts`, find the streaming delta handler inside `dispatchMeta` (around line 261-282). Modify the streaming ChatPart creation to include `parentToolUseId`:

```typescript
    // streaming delta: buffer the token
    if (msg.type === 'assistant' && msg.subtype === 'streaming') {
      const msgs = messages[cardId];
      if (!msgs) return;
      const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      if (!last || last.kind !== 'assistant' || !last.data.streaming) {
        // Create a new streaming ChatPart
        const newPart: ChatPart = {
          id: 'assistant-streaming',
          kind: 'assistant',
          placement: 'inline',
          timestamp: Date.now(),
          data: { content: '', streaming: true, parentToolUseId: msg.parentToolUseId ?? null },
        };
        msgs.push(newPart);
      }
      _bufferStreamingToken(cardId, msg.content as string);
      return;
    }
```

Do the same for the thinking streaming handler (around line 285-296).

- [ ] **Step 2: Commit**

```bash
git add app/stores/sessions.ts
git commit -m "feat(store): pass parentToolUseId through streaming delta handling"
```

---

### Task 3: Add registry entries for Skill and Agent tools

**Files:**
- Modify: `app/services/chat-part-registry.ts:73-114` (Tool Overrides section)

- [ ] **Step 1: Register tool_use:Skill as hidden**

Add after the existing `tool_use:AskUserQuestion` entry (line 80):

```typescript
  // Skill tool_use is hidden — the synthetic user message becomes the SyntheticBadge
  'tool_use:Skill': {
    placement: 'hidden',
    component: null,
    verbosity: 'quiet',
    parse: (raw) => ({
      toolUseId: raw.toolUseId ?? '',
      skillName: (raw.toolInput as Record<string, unknown>)?.skill ?? '',
    }),
  },
```

- [ ] **Step 2: Register tool_use:Agent as SubagentBlock**

Add after the new `tool_use:Skill` entry:

```typescript
  // Agent tool_use renders as a collapsible subagent block
  'tool_use:Agent': {
    placement: 'inline',
    component: 'SubagentBlock',
    verbosity: 'quiet',
    parse: (raw) => ({
      toolName: raw.toolName ?? 'Agent',
      toolInput: raw.toolInput ?? {},
      toolUseId: raw.toolUseId ?? '',
      description: (raw.toolInput as Record<string, unknown>)?.description ?? '',
      parentToolUseId: raw.parentToolUseId ?? null,
      ...(raw.toolResult !== undefined ? { toolResult: raw.toolResult } : {}),
    }),
  },
```

- [ ] **Step 3: Commit**

```bash
git add app/services/chat-part-registry.ts
git commit -m "feat(registry): add tool_use:Skill (hidden) and tool_use:Agent (SubagentBlock) entries"
```

---

### Task 4: Create SyntheticBadge component

**Files:**
- Create: `app/components/SyntheticBadge.vue`

- [ ] **Step 1: Create the SyntheticBadge component**

```vue
<script setup lang="ts">
import type { ChatPart } from '~/types';

const props = defineProps<{ part: ChatPart; cardId: string }>();

const isExpanded = ref(false);
function toggle() { isExpanded.value = !isExpanded.value; }

const content = computed(() => (props.part.data.content as string) || '');

// Detect the type of synthetic message from content
const badge = computed(() => {
  const text = content.value;

  // Skill loaded: look for <command-name> tag
  const cmdMatch = text.match(/<command-name>\/?([^<]+)<\/command-name>/);
  if (cmdMatch) {
    return { icon: 'i-lucide-puzzle', type: 'Skill loaded', name: cmdMatch[1].trim() };
  }

  // System reminder: look for <system-reminder> tag
  if (text.includes('<system-reminder>')) {
    // Extract first meaningful line after the tag
    const afterTag = text.replace(/<\/?system-reminder>/g, '').trim();
    const firstLine = afterTag.split('\n').find(l => l.trim())?.trim() || 'System';
    return { icon: 'i-lucide-bell', type: 'System', name: firstLine.substring(0, 50) };
  }

  // Generic internal message
  return { icon: 'i-lucide-eye-off', type: 'Internal', name: text.substring(0, 40).trim() };
});
</script>

<template>
  <div class="synthetic-badge" @click="toggle">
    <div class="badge-header">
      <UIcon :name="badge.icon" class="badge-icon" />
      <span class="badge-type">{{ badge.type }}</span>
      <span class="badge-name">{{ badge.name }}</span>
      <UIcon
        name="i-lucide-chevron-down"
        class="badge-chevron"
        :class="{ open: isExpanded }"
      />
    </div>
    <div v-if="isExpanded" class="badge-content">
      {{ content }}
    </div>
  </div>
</template>

<style scoped>
.synthetic-badge {
  background: var(--bg-secondary);
  border: 1px solid var(--bg-tertiary);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  cursor: pointer;
  user-select: none;
  transition: border-color 150ms, background 150ms;
}
.synthetic-badge:hover { border-color: var(--border); }

.badge-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.badge-icon { font-size: 14px; color: var(--text-muted); flex-shrink: 0; }
.badge-type { color: var(--accent); font-weight: 500; font-size: 11px; }
.badge-name { color: var(--text-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge-chevron {
  margin-left: auto;
  font-size: 12px;
  color: var(--bg-tertiary);
  transition: transform 200ms;
  flex-shrink: 0;
}
.badge-chevron.open { transform: rotate(180deg); }

.badge-content {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--bg-tertiary);
  font-size: 11px;
  color: var(--text-muted);
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  line-height: 1.4;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add app/components/SyntheticBadge.vue
git commit -m "feat(ui): add SyntheticBadge component for collapsible synthetic messages"
```

---

### Task 5: Create SubagentBlock component

**Files:**
- Create: `app/components/SubagentBlock.vue`

- [ ] **Step 1: Create the SubagentBlock component**

```vue
<script setup lang="ts">
import type { ChatPart } from '~/types';

const props = defineProps<{ part: ChatPart; cardId: string }>();

const sessionsStore = useSessionsStore();

const toolUseId = computed(() => (props.part.data.toolUseId as string) || '');
const description = computed(() => (props.part.data.description as string) || 'Subagent');
const toolResult = computed(() => props.part.data.toolResult as string | undefined);

// Collect all child parts that belong to this subagent
const childParts = computed(() => {
  const allParts = sessionsStore.getMessages(props.cardId);
  return allParts.filter(p =>
    (p.data.parentToolUseId as string) === toolUseId.value,
  );
});

// State: running / completed / error
const state = computed(() => {
  if (toolResult.value) {
    // Check if the result indicates an error
    const result = toolResult.value;
    if (typeof result === 'string' && (result.includes('error') || result.includes('Error'))) {
      return 'error';
    }
    return 'completed';
  }
  return 'running';
});

// Auto-expand when running, collapse when done
const manualOverride = ref<boolean | null>(null);
const isExpanded = computed(() => {
  if (manualOverride.value !== null) return manualOverride.value;
  return state.value === 'running';
});

function toggle() {
  manualOverride.value = !isExpanded.value;
}

// Reset manual override when state changes
watch(state, () => { manualOverride.value = null; });

// Elapsed time tracking
const startedAt = ref(Date.now());
const now = ref(Date.now());
let timerInterval: ReturnType<typeof setInterval> | null = null;

const elapsedSeconds = computed(() => Math.floor((now.value - startedAt.value) / 1000));

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

// Token tracking from child assistant parts
const tokenCount = computed(() => {
  let tokens = 0;
  for (const p of childParts.value) {
    if (p.kind === 'assistant' && p.data.usage) {
      tokens += ((p.data.usage as { outputTokens?: number }).outputTokens ?? 0);
    }
  }
  return tokens;
});

const tokenText = computed(() => {
  if (tokenCount.value >= 1000) return `${(tokenCount.value / 1000).toFixed(1)}k tokens`;
  return `${tokenCount.value} tokens`;
});

// Categorize child parts for rendering
function isChildSynthetic(part: ChatPart): boolean {
  return part.kind === 'user' && (part.data.isSynthetic as boolean) === true;
}

function childToolSummary(part: ChatPart): string {
  const input = (part.data.toolInput as Record<string, unknown>) || {};
  const name = (part.data.toolName as string) || '';
  switch (name) {
    case 'Bash': return `$ ${(input.command as string || '').substring(0, 60)}`;
    case 'Read': return `${input.file_path}`;
    case 'Write': return `${input.file_path}`;
    case 'Edit': return `${input.file_path}`;
    case 'Glob': return `${input.pattern}`;
    case 'Grep': return `"${input.pattern}" in ${input.path || '.'}`;
    default: return name;
  }
}

onMounted(() => {
  timerInterval = setInterval(() => { now.value = Date.now(); }, 1000);
});

onUnmounted(() => {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
});
</script>

<template>
  <div class="subagent-block" :class="state">
    <div class="subagent-header" @click="toggle">
      <span class="subagent-led" />
      <span class="subagent-label">Agent</span>
      <span class="subagent-desc">{{ description }}</span>
      <span class="subagent-meta">
        <span>{{ formatTime(elapsedSeconds) }}</span>
        <template v-if="state !== 'running'">
          <span>&middot;</span>
          <span>{{ tokenText }}</span>
        </template>
      </span>
      <UIcon
        name="i-lucide-chevron-down"
        class="subagent-chevron"
        :class="{ open: isExpanded }"
      />
    </div>

    <div v-if="isExpanded" class="subagent-body">
      <div class="subagent-chat">
        <template v-for="child in childParts" :key="child.id">
          <!-- Synthetic user message (subagent prompt) -->
          <div v-if="isChildSynthetic(child)" class="sub-synthetic">
            &#8627; Subagent prompt
          </div>

          <!-- Tool calls -->
          <div v-else-if="child.kind === 'tool_use'" class="sub-tool">
            <span class="sub-tool-icon">&#9889;</span>
            <span class="sub-tool-name">{{ child.data.toolName }}</span>
            <span class="sub-tool-summary">{{ childToolSummary(child) }}</span>
            <span v-if="child.data.toolResult" class="sub-tool-result">&#10003;</span>
            <span v-else class="sub-tool-pending">&#8987;</span>
          </div>

          <!-- Assistant text -->
          <div v-else-if="child.kind === 'assistant' && !child.data.thinking" class="sub-assistant">
            {{ (child.data.content as string || '').substring(0, 300) }}
            <span v-if="(child.data.content as string || '').length > 300" class="sub-truncated">...</span>
          </div>
        </template>

        <!-- Final result -->
        <div v-if="toolResult" class="sub-result">
          <strong>Result:</strong> {{ typeof toolResult === 'string' ? toolResult.substring(0, 500) : '' }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.subagent-block {
  background: var(--bg-primary);
  border: 1px solid var(--bg-tertiary);
  border-left: 3px solid var(--accent);
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 200ms;
}
.subagent-block.running  { border-left-color: var(--warning); }
.subagent-block.completed { border-left-color: var(--success); }
.subagent-block.error    { border-left-color: var(--error); }

.subagent-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  transition: background 150ms;
}
.subagent-header:hover { background: var(--bg-secondary); }

.subagent-led {
  width: 6px; height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.running .subagent-led  { background: var(--warning); animation: pulse 1.2s ease-in-out infinite; }
.completed .subagent-led { background: var(--success); }
.error .subagent-led    { background: var(--error); }

.subagent-label { color: var(--text-muted); font-size: 11px; }
.subagent-desc {
  color: var(--text-secondary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.subagent-meta {
  display: flex;
  gap: 6px;
  color: var(--text-muted);
  font-size: 11px;
  flex-shrink: 0;
}
.subagent-chevron {
  font-size: 12px;
  color: var(--bg-tertiary);
  transition: transform 200ms;
  flex-shrink: 0;
}
.subagent-chevron.open { transform: rotate(180deg); }

.subagent-body {
  border-top: 1px solid var(--bg-tertiary);
  padding: 10px 12px;
  background: #191a2c;
}

.subagent-chat { display: flex; flex-direction: column; gap: 6px; }

.sub-synthetic {
  padding: 3px 10px;
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
  opacity: 0.6;
}

.sub-tool {
  background: var(--bg-secondary);
  border: 1px solid var(--bg-tertiary);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 11px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  display: flex;
  align-items: center;
  gap: 5px;
}
.sub-tool-icon { color: var(--success); font-size: 10px; }
.sub-tool-name { color: var(--text-secondary); font-weight: 500; }
.sub-tool-summary { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.sub-tool-result { color: var(--success); font-size: 10px; margin-left: auto; }
.sub-tool-pending { color: var(--warning); font-size: 10px; margin-left: auto; }

.sub-assistant {
  padding: 4px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
}
.sub-truncated { color: var(--text-muted); }

.sub-result {
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-muted);
  border-top: 1px solid var(--bg-tertiary);
  margin-top: 4px;
  padding-top: 8px;
  line-height: 1.4;
}
.sub-result strong { color: var(--text-secondary); font-weight: 500; }

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.4; transform: scale(0.7); }
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add app/components/SubagentBlock.vue
git commit -m "feat(ui): add SubagentBlock component for collapsible subagent message streams"
```

---

### Task 6: Update useChatParts to route subagent messages

**Files:**
- Modify: `app/composables/useChatParts.ts`

- [ ] **Step 1: Filter subagent messages out of the main inline stream**

Subagent messages have `parentToolUseId` set. They should not appear in the main chat — instead they get picked up by the `SubagentBlock` component which queries the store directly. Add a filter to `inlineParts`:

```typescript
  // Parts for the inline zone: normal inline parts + resolved action-bar parts in chronological order
  // Exclude parts that belong to a subagent (parentToolUseId is set)
  const inlineParts = computed(() => {
    return allParts.value.filter(p => {
      const belongsToSubagent = p.data.parentToolUseId != null && p.data.parentToolUseId !== '';
      if (belongsToSubagent) return false;
      return (
        (p.placement === 'inline' && isVisible(p)) ||
        (p.placement === 'action-bar' && p.resolved)
      );
    });
  });
```

Also apply the same filter to `progressParts` so subagent progress events don't appear in the main progress bar:

```typescript
  const progressParts = computed(() => {
    return allParts.value.filter(p => {
      const belongsToSubagent = p.data.parentToolUseId != null && p.data.parentToolUseId !== '';
      if (belongsToSubagent) return false;
      return p.placement === 'progress';
    });
  });
```

- [ ] **Step 2: Commit**

```bash
git add app/composables/useChatParts.ts
git commit -m "feat(routing): filter subagent messages out of main chat stream"
```

---

### Task 7: Update useUIMessages to handle synthetic users and SubagentBlock

**Files:**
- Modify: `app/composables/useUIMessages.ts:58-68` (user message handling)

- [ ] **Step 1: Render synthetic user messages as SyntheticBadge**

In `useUIMessages.ts`, the `if (part.kind === 'user')` branch currently always creates a user message. Add a check for `isSynthetic`:

```typescript
      if (part.kind === 'user') {
        if (currentAssistant) { result.push(currentAssistant); currentAssistant = null; }

        // Synthetic user messages render as SyntheticBadge (via chat-part)
        if (part.data.isSynthetic) {
          result.push({ id: part.id, role: 'assistant', parts: [{ type: 'chat-part', chatPart: part }] });
          continue;
        }

        const userParts: UIMessagePart[] = [];
        const images = part.data.images as Array<{ data: string; mediaType: string; name: string }> | undefined;
        if (images?.length) {
          for (const img of images) {
            userParts.push({ type: 'image', data: img.data, mediaType: img.mediaType, name: img.name });
          }
        }
        userParts.push({ type: 'text', text: (part.data.content as string) || '' });
        result.push({ id: part.id, role: 'user', parts: userParts });
```

- [ ] **Step 2: Handle tool_use:Agent (SubagentBlock) as assistant part**

The `tool_use:Agent` parts will have `kind === 'tool_use:Agent'` after registry resolution. They are already handled by the `isAssistantRole` check since `part.kind` starts with `tool_use`. However, we need to make sure the component dispatch in ChatPanel recognizes `SubagentBlock`. Since registry-resolved tool parts go through `dynamic-tool` rendering in ChatPanel, and `SubagentBlock` is registered as a component in the registry, we need to ensure the `tool_use:Agent` part routes through the `chat-part` template path instead of `dynamic-tool`.

Update the `isAssistantRole` check to exclude `tool_use:Agent`:

```typescript
      const isAssistantRole = (part.kind === 'assistant' || part.kind === 'tool_use') && part.kind !== 'tool_use:Agent';
```

Then add a handler for `tool_use:Agent` in the else branch, so it renders via `chat-part`:

```typescript
      } else if (part.kind === 'tool_use:Agent') {
        // SubagentBlock renders as its own component via registry
        if (currentAssistant) { result.push(currentAssistant); currentAssistant = null; }
        result.push({ id: part.id, role: 'assistant', parts: [{ type: 'chat-part', chatPart: part }] });
```

- [ ] **Step 3: Commit**

```bash
git add app/composables/useUIMessages.ts
git commit -m "feat(ui-messages): route synthetic users to SyntheticBadge and Agent blocks to SubagentBlock"
```

---

### Task 8: Update ChatPanel to render new components

**Files:**
- Modify: `app/components/ChatPanel.vue:304-311` (chat-part template section)

- [ ] **Step 1: Ensure ChatPanel's getComponent helper resolves new component names**

ChatPanel has a `getComponent` function that resolves registry component names. Since Nuxt auto-imports components from `app/components/`, `SyntheticBadge` and `SubagentBlock` will be auto-resolved. However, verify that the `chat-part` template path in ChatPanel (lines 305-311) properly passes `part` and `card-id` props:

```vue
            <!-- ChatPart rendered via registry component (resolved actions, etc.) -->
            <template v-else-if="part.type === 'chat-part'">
              <component
                :is="getComponent(part.chatPart.kind)"
                :part="part.chatPart"
                :card-id="sessionsStore.activeChatCardId!"
              />
            </template>
```

This already passes `part` and `card-id` which both `SyntheticBadge` and `SubagentBlock` accept. No changes needed to ChatPanel if the pattern already works.

Verify by checking `getComponent`:

```typescript
function getComponent(kind: string): string | null {
  const def = registry[kind] || registry['_default']!;
  return def.component;
}
```

This resolves `tool_use:Agent` → `SubagentBlock` and synthetic users → `SyntheticBadge`.

For synthetic user parts, we need to register a synthetic user definition in the registry. Add this to the registry in `chat-part-registry.ts`:

```typescript
  // Synthetic user messages (skill prompts, system-reminders) render as SyntheticBadge
  'user:synthetic': {
    placement: 'inline',
    component: 'SyntheticBadge',
    verbosity: 'quiet',
    parse: (raw) => ({
      content: raw.content ?? '',
      isSynthetic: true,
    }),
  },
```

Then in `useUIMessages.ts`, when we detect a synthetic user part, set its `kind` to `'user:synthetic'` before pushing it as a `chat-part`. Alternatively, just hardcode `SyntheticBadge` in the ChatPanel template for `chat-part` parts whose `chatPart.data.isSynthetic` is true.

The simpler approach: in the `useUIMessages.ts` synthetic branch (Task 7 Step 1), we already push the part as a `chat-part`. We just need the registry to know about it. Since the original `part.kind` is `'user'`, `getComponent('user')` would return `'UserMessageBlock'` — wrong.

Fix: in `useUIMessages.ts`, when creating the chat-part for a synthetic user, override the kind:

```typescript
        if (part.data.isSynthetic) {
          const syntheticPart = { ...part, kind: 'user:synthetic' };
          result.push({ id: part.id, role: 'assistant', parts: [{ type: 'chat-part', chatPart: syntheticPart }] });
          continue;
        }
```

- [ ] **Step 2: Add user:synthetic to registry**

In `app/services/chat-part-registry.ts`, add the `user:synthetic` entry in the Tool Overrides section:

```typescript
  'user:synthetic': {
    placement: 'inline',
    component: 'SyntheticBadge',
    verbosity: 'quiet',
    parse: (raw) => ({
      content: raw.content ?? '',
      isSynthetic: true,
    }),
  },
```

- [ ] **Step 3: Commit**

```bash
git add app/services/chat-part-registry.ts app/composables/useUIMessages.ts app/components/ChatPanel.vue
git commit -m "feat(chat): wire SyntheticBadge and SubagentBlock into ChatPanel rendering"
```

---

### Task 9: Manual integration test

**Files:** none (testing only)

- [ ] **Step 1: Rebuild sidecar**

```bash
pnpm build:sidecar
```

- [ ] **Step 2: Run the app in dev mode**

```bash
pnpm tauri dev
```

- [ ] **Step 3: Test synthetic messages**

Open a card, start a chat session, and invoke a skill (e.g., type `/commit` or ask Claude to use a skill). Verify:
- The skill prompt appears as a collapsible "Skill loaded: name" badge (not a full user message)
- Clicking the badge expands to show the full skill content
- System-reminders (if any hooks fire) appear as "System" badges

- [ ] **Step 4: Test subagent blocks**

Ask Claude to do something that dispatches a subagent (e.g., "explore the codebase structure"). Verify:
- The Agent tool_use renders as a `SubagentBlock` with description
- While running: yellow left border, pulsing LED, auto-expanded
- When complete: green left border, static LED, auto-collapsed
- Expanding shows the subagent's tool calls and assistant messages
- The main chat stream does not contain the subagent's internal messages

- [ ] **Step 5: Test parallel subagents**

Ask Claude to do two things in parallel (e.g., "investigate X and Y at the same time"). Verify:
- Two separate SubagentBlock widgets appear stacked
- Each tracks its own state independently

- [ ] **Step 6: Verify real user messages unchanged**

Type a normal user message. Verify it still renders as the standard user bubble on the right side.

- [ ] **Step 7: Commit any fixes if needed**

```bash
git add -A
git commit -m "fix: address integration test findings"
```

---

## Task Dependency Graph

```
Task 1 (sidecar propagation)
  └→ Task 2 (streaming passthrough)
      └→ Task 3 (registry entries)
          ├→ Task 4 (SyntheticBadge component)
          └→ Task 5 (SubagentBlock component)
              └→ Task 6 (useChatParts routing)
                  └→ Task 7 (useUIMessages handling)
                      └→ Task 8 (ChatPanel wiring)
                          └→ Task 9 (integration test)
```

All tasks are sequential — each builds on the previous.
