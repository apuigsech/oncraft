# Chat Panel Improvements — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade ClaudBan's chat panel from basic text I/O to a feature-rich Claude Code experience with streaming, markdown, tool visualization, metrics, and input enhancements.

**Architecture:** The agent-bridge sidecar (Node.js/Bun) uses `@anthropic-ai/claude-agent-sdk` to communicate with Claude Code. The frontend (Vue 3) renders messages from the sidecar via Tauri shell plugin IPC. Changes span both sidecar and frontend.

**Tech Stack additions:** `marked` + `highlight.js` (markdown+syntax highlighting), `vue-command-palette` or custom autocomplete

---

## File Structure (new/modified files)

```
src/
  components/
    ChatMessage.vue              # MODIFY: add markdown rendering, thinking blocks
    ChatPanel.vue                # MODIFY: add status bar, cancel button, mode switcher, multi-line input
    ToolCallBlock.vue            # MODIFY: add tool-specific icons, diff view for Edit, bash display
    ContextGauge.vue             # CREATE: context window usage bar
    SessionMetrics.vue           # CREATE: cost, tokens, duration display
    SlashCommandPalette.vue      # CREATE: autocomplete popup for / commands
    TaskListDisplay.vue          # CREATE: TodoWrite/plan display
  types/
    index.ts                     # MODIFY: add SessionMetrics, PermissionMode types

src-sidecar/
    agent-bridge.ts              # MODIFY: add streaming support, permission mode, slash commands
```

---

## Feature 1: Real-time Streaming

Currently `send()` uses `execute()` which waits for completion. The sidecar already uses the SDK's async generator (`for await (const message of conversation)`) which streams messages in real-time. The frontend just needs to display messages as they arrive instead of waiting for the result.

### Task 1.1: Enable streaming text in ChatMessage

**Files:** `src/components/ChatMessage.vue`

- [ ] **Step 1:** Install markdown dependencies

```bash
pnpm add marked highlight.js
```

- [ ] **Step 2:** This is combined with Feature 2 (Markdown). ChatMessage already receives messages in real-time from the sidecar via the `onMessage` callback. The issue is that the bridge emits complete `assistant` messages only after Claude finishes each content block. To get token-by-token streaming, the bridge needs to also emit `stream_event` partial messages.

- [ ] **Step 3:** Update agent-bridge to emit partial text deltas

In `src-sidecar/agent-bridge.ts`, add handling for `stream_event` type messages in `translateMessage`:

```typescript
// In translateMessage, add before the final return:
if (msg.type === "stream_event") {
  const event = (msg as Record<string, unknown>).event as Record<string, unknown>;
  if (event?.type === "content_block_delta") {
    const delta = event.delta as Record<string, unknown>;
    if (delta?.type === "text_delta") {
      return {
        type: "assistant",
        subtype: "streaming",
        content: delta.text as string,
      };
    }
  }
  return null; // Skip other stream events
}
```

Also add `includePartialMessages: true` to the `query()` options.

- [ ] **Step 4:** Update sessions store to accumulate streaming text

In `sessions.ts`, modify `appendMessage` to handle `subtype: "streaming"` by appending to the last assistant message instead of creating a new one:

```typescript
function appendMessage(cardId: string, msg: StreamMessage): void {
  if (!messages[cardId]) { messages[cardId] = []; }
  if (msg.type === 'system' && !msg.content && !msg.sessionId) return;

  // Streaming: append to last assistant message
  if (msg.subtype === 'streaming') {
    const msgs = messages[cardId];
    const last = msgs[msgs.length - 1];
    if (last && last.type === 'assistant' && last.subtype === 'streaming') {
      last.content += msg.content;
      return;
    }
  }

  messages[cardId].push(msg);
}
```

- [ ] **Step 5:** Rebuild sidecar, verify streaming works
- [ ] **Step 6:** Commit: "feat: enable real-time streaming from Claude via SDK partial messages"

---

## Feature 2: Markdown Rendering with Code Blocks

### Task 2.1: Add markdown renderer to ChatMessage

**Files:** `src/components/ChatMessage.vue`

- [ ] **Step 1:** Create a markdown rendering utility

```typescript
// src/services/markdown.ts
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';

marked.setOptions({
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
});

export function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false }) as string;
}
```

- [ ] **Step 2:** Update ChatMessage to use v-html with markdown

```vue
<script setup lang="ts">
import type { StreamMessage } from '../types';
import { computed } from 'vue';
import { renderMarkdown } from '../services/markdown';

const props = defineProps<{ message: StreamMessage }>();

const renderedContent = computed(() => {
  if (props.message.type === 'assistant') {
    return renderMarkdown(props.message.content);
  }
  return props.message.content;
});

const isThinking = computed(() => props.message.subtype === 'thinking');
</script>

<template>
  <div class="chat-message" :class="[message.type, { thinking: isThinking }]">
    <div v-if="message.type === 'assistant'" class="msg-bubble assistant">
      <span class="msg-role">{{ isThinking ? 'Thinking' : 'Claude' }}</span>
      <div class="msg-content" v-html="renderedContent" />
    </div>
    <div v-else-if="message.type === 'user'" class="msg-bubble user">
      <span class="msg-role">You</span>
      <div class="msg-content">{{ message.content }}</div>
    </div>
    <div v-else-if="message.type === 'system'" class="msg-system">{{ message.content }}</div>
  </div>
</template>
```

Add styles for thinking blocks, code blocks, and markdown elements.

- [ ] **Step 3:** Commit: "feat: add markdown rendering with syntax highlighting to chat messages"

---

## Feature 3: Cancel/Interrupt Button

### Task 3.1: Add stop button to ChatPanel

**Files:** `src/components/ChatPanel.vue`, `src/stores/sessions.ts`

- [ ] **Step 1:** The bridge already has `interrupt` command support (AbortController). The sessions store already has `interruptSession()`. Add a Stop button to ChatPanel that appears while a query is active.

```html
<!-- In chat-input-area, before the textarea -->
<button v-if="isActive" class="stop-btn" @click="handleInterrupt" title="Stop generation">
  ■ Stop
</button>
```

```typescript
const isActive = computed(() => {
  if (!sessionsStore.activeChatCardId) return false;
  return sessionsStore.isActive(sessionsStore.activeChatCardId);
});

async function handleInterrupt() {
  if (sessionsStore.activeChatCardId) {
    await sessionsStore.interruptSession(sessionsStore.activeChatCardId);
  }
}
```

- [ ] **Step 2:** Style the stop button (red, replaces Send while active)
- [ ] **Step 3:** Commit: "feat: add cancel/stop button during active generation"

---

## Feature 4: Permission Mode Switcher

### Task 4.1: Add mode selector to ChatPanel header

**Files:** `src/components/ChatPanel.vue`, `src/stores/sessions.ts`, `src-sidecar/agent-bridge.ts`, `src/types/index.ts`

- [ ] **Step 1:** Add PermissionMode type

```typescript
// In types/index.ts
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
```

- [ ] **Step 2:** Add permissionMode to sessions store and a setter that sends to the bridge

```typescript
const permissionMode = ref<PermissionMode>('default');

async function setPermissionMode(cardId: string, mode: PermissionMode): Promise<void> {
  permissionMode.value = mode;
  // Send to bridge for next query
}
```

- [ ] **Step 3:** Update agent-bridge to accept permissionMode in start command and pass to `query()` options

- [ ] **Step 4:** Add mode dropdown to ChatPanel header

```html
<select v-model="currentMode" @change="onModeChange" class="mode-selector">
  <option value="default">Default</option>
  <option value="acceptEdits">Auto-edit</option>
  <option value="plan">Plan only</option>
  <option value="bypassPermissions">Full auto</option>
</select>
```

Style with color coding: green (auto), yellow (plan), red (bypass).

- [ ] **Step 5:** Add Shift+Tab keyboard shortcut to cycle modes
- [ ] **Step 6:** Commit: "feat: add permission mode switcher with Shift+Tab shortcut"

---

## Feature 5: Context Window Gauge

### Task 5.1: Create ContextGauge component

**Files:** `src/components/ContextGauge.vue`, `src/stores/sessions.ts`

- [ ] **Step 1:** Track cumulative token usage in sessions store

```typescript
// In sessions store
const sessionMetrics: Record<string, { inputTokens: number; outputTokens: number; costUsd: number; durationMs: number }> = reactive({});
```

Update the message listener to accumulate usage from assistant and result messages.

- [ ] **Step 2:** Create ContextGauge component

```vue
<!-- src/components/ContextGauge.vue -->
<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ inputTokens: number; maxTokens?: number }>();
const max = computed(() => props.maxTokens || 200000); // Claude's context window
const percent = computed(() => Math.min(100, (props.inputTokens / max.value) * 100));
const color = computed(() => {
  if (percent.value < 50) return 'var(--success)';
  if (percent.value < 80) return 'var(--warning)';
  return 'var(--error)';
});
</script>

<template>
  <div class="context-gauge" :title="`${props.inputTokens.toLocaleString()} / ${max.value.toLocaleString()} tokens`">
    <div class="gauge-bar" :style="{ width: percent + '%', background: color }" />
    <span class="gauge-label">{{ Math.round(percent) }}%</span>
  </div>
</template>
```

- [ ] **Step 3:** Add to ChatPanel header
- [ ] **Step 4:** Commit: "feat: add context window usage gauge"

---

## Feature 6: Cost & Token Tracking

### Task 6.1: Create SessionMetrics component

**Files:** `src/components/SessionMetrics.vue`, `src/stores/sessions.ts`

- [ ] **Step 1:** The bridge already emits `result` messages with `costUsd`, `durationMs`, and `usage`. Accumulate in sessions store (from Feature 5 metrics).

- [ ] **Step 2:** Create SessionMetrics component showing in the chat header or footer:

```vue
<!-- src/components/SessionMetrics.vue -->
<template>
  <div class="session-metrics">
    <span class="metric" title="Cost">💰 ${{ costUsd.toFixed(4) }}</span>
    <span class="metric" title="Tokens">📊 {{ (inputTokens + outputTokens).toLocaleString() }}</span>
    <span class="metric" title="Duration">⏱ {{ formatDuration(durationMs) }}</span>
  </div>
</template>
```

- [ ] **Step 3:** Add to ChatPanel footer (between messages and input)
- [ ] **Step 4:** Commit: "feat: add session cost, token, and duration tracking"

---

## Feature 7: Improved Tool Call Cards

### Task 7.1: Add tool-specific icons and summaries

**Files:** `src/components/ToolCallBlock.vue`

- [ ] **Step 1:** Add a tool icon/label map

```typescript
const TOOL_INFO: Record<string, { icon: string; label: string }> = {
  Bash: { icon: '⚡', label: 'Run command' },
  Read: { icon: '📖', label: 'Read file' },
  Write: { icon: '📝', label: 'Write file' },
  Edit: { icon: '✏️', label: 'Edit file' },
  Glob: { icon: '🔍', label: 'Find files' },
  Grep: { icon: '🔎', label: 'Search content' },
  WebFetch: { icon: '🌐', label: 'Fetch URL' },
  Agent: { icon: '🤖', label: 'Sub-agent' },
  AskUserQuestion: { icon: '❓', label: 'Question' },
};
```

- [ ] **Step 2:** Generate smart summaries from tool input

```typescript
function getSummary(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash': return `$ ${input.command}`;
    case 'Read': return `${input.file_path}`;
    case 'Write': return `${input.file_path}`;
    case 'Edit': return `${input.file_path}`;
    case 'Glob': return `${input.pattern}`;
    case 'Grep': return `"${input.pattern}" in ${input.path || '.'}`;
    case 'WebFetch': return `${input.url}`;
    case 'Agent': return `${input.description || input.prompt?.toString().substring(0, 50)}`;
    default: return toolName;
  }
}
```

- [ ] **Step 3:** For Edit tools, show a simple diff view (old_string vs new_string) when expanded

```html
<div v-if="isEdit && expanded" class="edit-diff">
  <div class="diff-removed">{{ message.toolInput?.old_string }}</div>
  <div class="diff-added">{{ message.toolInput?.new_string }}</div>
</div>
```

- [ ] **Step 4:** For Bash tools, show command with monospace styling and output

- [ ] **Step 5:** Commit: "feat: add tool-specific icons, summaries, and diff view for Edit"

---

## Feature 8: Multi-line Input

### Task 8.1: Support Shift+Enter for newlines

**Files:** `src/components/ChatPanel.vue`

- [ ] **Step 1:** Change the textarea keydown handler

Currently: `@keydown.enter.exact.prevent="sendMessage"` — Enter sends, no way to add newlines.

Change to:
```html
<textarea
  v-model="input"
  placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
  rows="2"
  @keydown.enter.exact.prevent="sendMessage"
  @keydown.shift.enter.prevent="insertNewline"
  ref="inputRef"
/>
```

```typescript
const inputRef = ref<HTMLTextAreaElement | null>(null);

function insertNewline() {
  input.value += '\n';
  // Auto-grow textarea
  nextTick(() => {
    if (inputRef.value) {
      inputRef.value.style.height = 'auto';
      inputRef.value.style.height = Math.min(inputRef.value.scrollHeight, 150) + 'px';
    }
  });
}
```

- [ ] **Step 2:** Add auto-grow behavior (textarea expands up to 6 lines)
- [ ] **Step 3:** Commit: "feat: support Shift+Enter for multi-line input with auto-grow"

---

## Feature 9: Slash Command Autocomplete

### Task 9.1: Create SlashCommandPalette component

**Files:** `src/components/SlashCommandPalette.vue`, `src/components/ChatPanel.vue`

- [ ] **Step 1:** Define the list of slash commands

```typescript
const SLASH_COMMANDS = [
  { name: '/clear', desc: 'Clear conversation and start fresh' },
  { name: '/compact', desc: 'Compact context to free space' },
  { name: '/cost', desc: 'Show session cost and token usage' },
  { name: '/context', desc: 'Show context window usage' },
  { name: '/diff', desc: 'Show file changes made this session' },
  { name: '/model', desc: 'Switch AI model' },
  { name: '/plan', desc: 'Enter plan mode' },
  { name: '/resume', desc: 'Resume a previous session' },
  { name: '/rewind', desc: 'Rewind to a previous point' },
  { name: '/export', desc: 'Export conversation to file' },
  { name: '/help', desc: 'Show available commands' },
];
```

- [ ] **Step 2:** Create autocomplete popup

```vue
<!-- src/components/SlashCommandPalette.vue -->
<script setup lang="ts">
const props = defineProps<{ filter: string; visible: boolean }>();
const emit = defineEmits<{ select: [command: string] }>();

const filtered = computed(() =>
  SLASH_COMMANDS.filter(c => c.name.startsWith(props.filter.toLowerCase()))
);
</script>

<template>
  <div v-if="visible && filtered.length" class="slash-palette">
    <div v-for="cmd in filtered" :key="cmd.name" class="slash-item"
      @click="emit('select', cmd.name)">
      <span class="slash-name">{{ cmd.name }}</span>
      <span class="slash-desc">{{ cmd.desc }}</span>
    </div>
  </div>
</template>
```

- [ ] **Step 3:** Wire into ChatPanel — show palette when input starts with `/`, filter as user types, select inserts command

- [ ] **Step 4:** Slash commands are sent as regular messages to the bridge (Claude handles them)

- [ ] **Step 5:** Commit: "feat: add slash command autocomplete popup"

---

## Feature 10: TodoWrite/Task Display

### Task 10.1: Create TaskListDisplay component

**Files:** `src/components/TaskListDisplay.vue`, `src/stores/sessions.ts`, `src-sidecar/agent-bridge.ts`

- [ ] **Step 1:** The SDK emits `system` messages with subtype `task_notification`, `task_started`, `task_progress`. The bridge currently passes these through as generic system messages. Add specific handling:

```typescript
// In agent-bridge translateMessage, add:
if (sysMsg.subtype === "task_notification" || sysMsg.subtype === "task_started") {
  return {
    type: "system",
    subtype: sysMsg.subtype,
    content: (sysMsg as Record<string, unknown>).summary || "",
    taskId: (sysMsg as Record<string, unknown>).task_id,
    taskStatus: (sysMsg as Record<string, unknown>).status,
  };
}
```

- [ ] **Step 2:** Add task tracking to sessions store

```typescript
interface TaskItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}
const sessionTasks: Record<string, TaskItem[]> = reactive({});
```

Parse `assistant` messages containing TodoWrite tool calls to extract task items. Update status from task_notification messages.

- [ ] **Step 3:** Create TaskListDisplay component

```vue
<!-- src/components/TaskListDisplay.vue -->
<template>
  <div v-if="tasks.length" class="task-list">
    <h4>Tasks</h4>
    <div v-for="task in tasks" :key="task.id" class="task-item" :class="task.status">
      <span class="task-checkbox">{{ task.status === 'completed' ? '✅' : task.status === 'in_progress' ? '🔄' : '⬜' }}</span>
      <span class="task-content">{{ task.content }}</span>
    </div>
  </div>
</template>
```

- [ ] **Step 4:** Render in ChatPanel when tasks exist for the session (sidebar or inline)
- [ ] **Step 5:** Commit: "feat: display TodoWrite tasks as interactive checklist"

---

## Feature 11: Input Toolbar (Model, Effort, Branch)

Inspired by Claude Code's desktop app input box, add a toolbar row above the textarea with selectors for model, effort level, and a git branch indicator.

### Task 11.1: Create InputToolbar component

**Files:** `src/components/InputToolbar.vue`, `src/components/ChatPanel.vue`, `src/stores/sessions.ts`, `src-sidecar/agent-bridge.ts`, `src/types/index.ts`

- [ ] **Step 1:** Add types

```typescript
// In types/index.ts
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
export type EffortLevel = 'low' | 'medium' | 'high' | 'max';
export type ModelAlias = 'opus' | 'sonnet' | 'haiku';

export interface SessionConfig {
  model: ModelAlias;
  effort: EffortLevel;
  permissionMode: PermissionMode;
  gitBranch?: string;
}
```

- [ ] **Step 2:** Add session config to sessions store

```typescript
const sessionConfigs: Record<string, SessionConfig> = reactive({});

function getSessionConfig(cardId: string): SessionConfig {
  if (!sessionConfigs[cardId]) {
    sessionConfigs[cardId] = { model: 'sonnet', effort: 'high', permissionMode: 'default' };
  }
  return sessionConfigs[cardId];
}

function updateSessionConfig(cardId: string, partial: Partial<SessionConfig>): void {
  const config = getSessionConfig(cardId);
  Object.assign(config, partial);
}
```

- [ ] **Step 3:** Update agent-bridge to accept model, effort, permissionMode in start command

In `agent-bridge.ts`, update the `start` handler:

```typescript
const conversation = query({
  prompt: cmd.prompt as string,
  options: {
    // ... existing options ...
    model: cmd.model as string | undefined,     // 'opus', 'sonnet', 'haiku'
    effort: cmd.effort as string | undefined,   // 'low', 'medium', 'high', 'max'
    permissionMode: cmd.permissionMode as string || "default",
  },
});
```

Also extract `gitBranch` from the `init` system message and emit it:

```typescript
if (sysMsg.subtype === "init") {
  return {
    type: "system",
    subtype: "init",
    sessionId: sysMsg.session_id,
    gitBranch: sysMsg.git_branch,
    model: sysMsg.model,
  };
}
```

- [ ] **Step 4:** Update sessions store `send()` to pass config to bridge

```typescript
// In the start/sendStart commands, include config:
const config = getSessionConfig(cardId);
const startCmd = JSON.stringify({
  cmd: 'start',
  prompt: message,
  projectPath: project.path,
  model: config.model,
  effort: config.effort,
  permissionMode: config.permissionMode,
  ...(sessionId ? { sessionId } : {}),
});
```

Also capture gitBranch from init messages:

```typescript
if (msg.subtype === 'init' && msg.gitBranch) {
  updateSessionConfig(cardId, { gitBranch: msg.gitBranch });
}
```

- [ ] **Step 5:** Create InputToolbar component

```vue
<!-- src/components/InputToolbar.vue -->
<script setup lang="ts">
import type { ModelAlias, EffortLevel, PermissionMode } from '../types';

const props = defineProps<{
  model: ModelAlias;
  effort: EffortLevel;
  permissionMode: PermissionMode;
  gitBranch?: string;
}>();

const emit = defineEmits<{
  'update:model': [value: ModelAlias];
  'update:effort': [value: EffortLevel];
  'update:permissionMode': [value: PermissionMode];
}>();

const MODEL_OPTIONS: { value: ModelAlias; label: string }[] = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
];

const EFFORT_OPTIONS: { value: EffortLevel; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'var(--text-muted)' },
  { value: 'medium', label: 'Med', color: 'var(--warning)' },
  { value: 'high', label: 'High', color: 'var(--accent)' },
  { value: 'max', label: 'Max', color: 'var(--error)' },
];

const MODE_OPTIONS: { value: PermissionMode; label: string; color: string }[] = [
  { value: 'default', label: 'Default', color: 'var(--text-secondary)' },
  { value: 'acceptEdits', label: 'Auto-edit', color: 'var(--success)' },
  { value: 'plan', label: 'Plan', color: 'var(--warning)' },
  { value: 'bypassPermissions', label: 'YOLO', color: 'var(--error)' },
];
</script>

<template>
  <div class="input-toolbar">
    <div class="toolbar-left">
      <!-- Model selector -->
      <select :value="model" @change="emit('update:model', ($event.target as HTMLSelectElement).value as ModelAlias)"
        class="toolbar-select">
        <option v-for="opt in MODEL_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>

      <!-- Effort selector -->
      <div class="effort-group">
        <button v-for="opt in EFFORT_OPTIONS" :key="opt.value"
          class="effort-btn" :class="{ active: effort === opt.value }"
          :style="effort === opt.value ? { color: opt.color, borderColor: opt.color } : {}"
          @click="emit('update:effort', opt.value)">
          {{ opt.label }}
        </button>
      </div>

      <!-- Permission mode -->
      <select :value="permissionMode"
        @change="emit('update:permissionMode', ($event.target as HTMLSelectElement).value as PermissionMode)"
        class="toolbar-select mode-select"
        :style="{ color: MODE_OPTIONS.find(m => m.value === permissionMode)?.color }">
        <option v-for="opt in MODE_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
    </div>

    <div class="toolbar-right">
      <!-- Git branch -->
      <span v-if="gitBranch" class="git-branch" title="Current git branch">
        ⎇ {{ gitBranch }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.input-toolbar {
  display: flex; justify-content: space-between; align-items: center;
  padding: 4px 10px; border-top: 1px solid var(--bg-tertiary);
  background: var(--bg-secondary); font-size: 11px;
}
.toolbar-left { display: flex; align-items: center; gap: 8px; }
.toolbar-right { display: flex; align-items: center; gap: 8px; }
.toolbar-select {
  background: var(--bg-primary); border: 1px solid var(--bg-tertiary);
  border-radius: 4px; padding: 2px 6px; font-size: 11px;
  color: var(--text-secondary); cursor: pointer;
}
.effort-group { display: flex; gap: 1px; background: var(--bg-tertiary); border-radius: 4px; overflow: hidden; }
.effort-btn {
  padding: 2px 8px; font-size: 10px; color: var(--text-muted);
  background: var(--bg-primary); border: 1px solid transparent;
  transition: all 0.15s;
}
.effort-btn.active { font-weight: 600; background: var(--bg-secondary); }
.mode-select { font-weight: 600; }
.git-branch {
  color: var(--text-muted); font-family: monospace; font-size: 11px;
  background: var(--bg-primary); padding: 2px 8px; border-radius: 3px;
}
</style>
```

- [ ] **Step 6:** Wire InputToolbar into ChatPanel, above the textarea

```html
<!-- In ChatPanel.vue, inside chat-input-area, before textarea -->
<InputToolbar
  v-if="card"
  :model="sessionConfig.model"
  :effort="sessionConfig.effort"
  :permission-mode="sessionConfig.permissionMode"
  :git-branch="sessionConfig.gitBranch"
  @update:model="v => sessionsStore.updateSessionConfig(card!.id, { model: v })"
  @update:effort="v => sessionsStore.updateSessionConfig(card!.id, { effort: v })"
  @update:permission-mode="v => sessionsStore.updateSessionConfig(card!.id, { permissionMode: v })"
/>
```

- [ ] **Step 7:** Rebuild sidecar, verify model/effort/mode are sent to Claude
- [ ] **Step 8:** Commit: "feat: add input toolbar with model, effort, permission mode, and git branch"

---

## Execution Order & Dependencies

```
Feature 2 (Markdown)     ──┐
Feature 8 (Multi-line)   ──┤──> Quick wins, no dependencies
Feature 3 (Cancel)       ──┘

Feature 11 (Toolbar)     ──> Supersedes Feature 4 (Mode Switch is now part of toolbar)
                              Also includes model, effort, branch

Feature 7 (Tool Cards)   ──> Independent

Feature 1 (Streaming)    ──> Depends on Feature 2 (markdown) + sidecar change

Feature 5 (Context)      ──┐
Feature 6 (Metrics)      ──┤──> Share metrics infrastructure
                           └──> Feature 5 before 6

Feature 9 (Slash Cmds)   ──> Independent

Feature 10 (Tasks)       ──> Independent, highest complexity
```

**Suggested execution order:**
1. Feature 2 (Markdown) — biggest visual impact, no dependencies
2. Feature 8 (Multi-line) — quick win
3. Feature 3 (Cancel) — quick win, already wired
4. Feature 11 (Input Toolbar) — model, effort, mode, branch (supersedes Feature 4)
5. Feature 7 (Tool Cards) — visual improvement
6. Feature 1 (Streaming) — depends on bridge change + Feature 2
7. Feature 5+6 (Context + Metrics) — together
8. Feature 9 (Slash Commands) — medium complexity
9. Feature 10 (Tasks) — highest complexity

Note: Feature 4 (Mode Switch) is now absorbed into Feature 11 (Input Toolbar).

## Summary

| Feature | Files Changed | Complexity | Sidecar Change? |
|---------|--------------|------------|-----------------|
| 1. Streaming | bridge, sessions, ChatMessage | High | Yes |
| 2. Markdown | ChatMessage, new markdown.ts | Medium | No |
| 3. Cancel | ChatPanel | Low | No (already wired) |
| 5. Context Gauge | new ContextGauge, sessions | Medium | No |
| 6. Metrics | new SessionMetrics, sessions | Low | No |
| 7. Tool Cards | ToolCallBlock | Medium | No |
| 8. Multi-line | ChatPanel | Low | No |
| 9. Slash Cmds | new SlashCommandPalette, ChatPanel | Medium | No |
| 10. Tasks | new TaskListDisplay, sessions, bridge | High | Yes |
| 11. Input Toolbar | new InputToolbar, ChatPanel, sessions, bridge, types | Medium | Yes |
