# Claude Code GUI Feature Research

**Date**: 2026-03-15
**Purpose**: Comprehensive analysis of Claude Code CLI features, community GUI patterns, and SDK capabilities for building the ClaudBan desktop GUI chat panel.

---

## Table of Contents

1. [SDK Message Types (What a GUI Can Display)](#1-sdk-message-types)
2. [Essential Features (Must Have)](#2-essential-features)
3. [Important Features (Significantly Improve UX)](#3-important-features)
4. [Nice-to-Have Features (Polish & Power-User)](#4-nice-to-have-features)
5. [Community GUI Comparison](#5-community-gui-comparison)
6. [Implementation Notes for ClaudBan](#6-implementation-notes-for-claudban)

---

## 1. SDK Message Types

The Claude Agent SDK streams messages as `SDKMessage` events. These define everything a GUI can render. When using `--output-format stream-json`, the CLI emits these as newline-delimited JSON.

### Complete Message Type Catalog

| Message Type | `type` Field | Key Fields | GUI Rendering |
|---|---|---|---|
| **AssistantMessage** | `assistant` | `message.content` (text blocks, tool_use blocks, thinking blocks), `usage`, `model` | Chat bubble with markdown, code blocks, thinking sections |
| **UserMessage** | `user` | `message.content` (text, images) | User chat bubble |
| **ResultMessage** | `result` | `subtype` (success/error_*), `total_cost_usd`, `duration_ms`, `usage`, `num_turns`, `modelUsage` | Session summary, cost display, error banners |
| **SystemMessage** | `system` (subtype: `init`) | `session_id`, `model`, `tools`, `mcp_servers`, `permissionMode`, `slash_commands`, `skills` | Session initialization metadata |
| **StatusMessage** | `system` (subtype: `status`) | `status` ("compacting" or null), `permissionMode` | Status indicators (compacting spinner) |
| **PartialAssistantMessage** | `stream_event` | `event` (Anthropic stream events: content_block_start/delta/stop, message_delta) | Real-time streaming text rendering |
| **CompactBoundaryMessage** | `system` (subtype: `compact_boundary`) | `compact_metadata.trigger`, `compact_metadata.pre_tokens` | Context compaction indicator |
| **ToolProgressMessage** | `tool_progress` | `tool_name`, `tool_use_id`, `elapsed_time_seconds`, `task_id` | Tool execution progress spinners |
| **ToolUseSummaryMessage** | `tool_use_summary` | `summary`, `preceding_tool_use_ids` | Collapsed tool call summaries |
| **HookStartedMessage** | `system` (subtype: `hook_started`) | `hook_name`, `hook_event` | Hook execution indicator |
| **HookProgressMessage** | `system` (subtype: `hook_progress`) | `hook_name`, stdout/stderr output | Hook output display |
| **HookResponseMessage** | `system` (subtype: `hook_response`) | Hook result data | Hook completion indicator |
| **TaskNotificationMessage** | `system` (subtype: `task_notification`) | `task_id`, `status`, `summary`, `usage` | Background task completion notices |
| **TaskStartedMessage** | `system` (subtype: `task_started`) | Task ID and metadata | Background task start indicator |
| **TaskProgressMessage** | `system` (subtype: `task_progress`) | Task progress data | Background task progress bar |
| **FilesPersistedEvent** | `system` (subtype: `files_persisted`) | `files[]`, `failed[]` | File checkpoint saved indicator |
| **RateLimitEvent** | `rate_limit_event` | `rate_limit_info.status` (allowed/warning/rejected), `utilization`, `resetsAt` | Rate limit warning banner |
| **PromptSuggestionMessage** | `prompt_suggestion` | `suggestion` | Auto-complete suggestion in input |
| **AuthStatusMessage** | `auth_status` | `isAuthenticating`, `output[]` | Auth flow display |

### Content Block Types Inside AssistantMessage

The `message.content` array in AssistantMessage contains these block types:

| Block Type | Fields | GUI Rendering |
|---|---|---|
| `text` | `text` | Markdown-rendered text with code blocks |
| `tool_use` | `id`, `name`, `input` | Collapsible tool call card with icon, name, and input preview |
| `tool_result` | `tool_use_id`, `content` | Result displayed inside the tool call card |
| `thinking` | `thinking` (text) | Collapsible thinking/reasoning section (often dimmed or italic) |

### Tool Input Schemas (for rendering tool calls)

| Tool | Key Input Fields | Suggested Card Summary |
|---|---|---|
| `Bash` | `command`, `description`, `timeout` | "Run: `{command}`" |
| `Read` | `file_path`, `offset`, `limit` | "Read: `{file_path}`" |
| `Write` | `file_path`, `content` | "Write: `{file_path}`" |
| `Edit` | `file_path`, `old_string`, `new_string` | "Edit: `{file_path}`" |
| `Glob` | `pattern`, `path` | "Find files: `{pattern}`" |
| `Grep` | `pattern`, `path` | "Search: `{pattern}`" |
| `WebFetch` | `url`, `prompt` | "Fetch: `{url}`" |
| `WebSearch` | query fields | "Search web: `{query}`" |
| `Agent` | `subagent_type`, `prompt`, `description` | "Sub-agent: `{description}`" |
| `AskUserQuestion` | `questions[]` with `options[]` | Interactive question UI |
| `NotebookEdit` | `notebook_path`, `cell_id` | "Edit notebook: `{notebook_path}`" |
| `TaskOutput` | `task_id` | "Get task output: `{task_id}`" |

---

## 2. Essential Features (Must Have)

### 2.1 Message Streaming & Rendering

**What it does**: Display Claude's responses in real-time as they stream in, character by character.

**CLI behavior**: Text appears incrementally in the terminal. Uses ANSI escape codes for formatting.

**SDK mechanism**: Enable `includePartialMessages: true` to receive `stream_event` messages containing `content_block_delta` events with incremental text deltas.

**GUI implementation**: Parse `stream_event` messages, accumulate text deltas, render markdown progressively. When a complete `assistant` message arrives, replace the partial render with the final version.

**Community GUI approach**: claude-code-gui polls JSONL files from `~/.claude/projects/` for streaming data. Renders assistant responses with markdown formatting and code block syntax highlighting.

**Complexity**: Medium. Requires incremental markdown parser and careful state management for partial renders.

### 2.2 Tool Call Display

**What it does**: Show when Claude uses tools (reads files, runs commands, edits code, etc.) with collapsible detail.

**CLI behavior**: Shows tool name and key argument as a one-line summary. Full input/output visible with `Ctrl+O` (verbose mode).

**SDK mechanism**: `assistant` messages contain `tool_use` content blocks. Tool results come as `user` messages with `tool_use_result` field. `tool_progress` messages show elapsed time during execution.

**GUI implementation**: Render each tool call as a collapsible card. Show icon + tool name + primary argument (e.g., file path or command). Expand to show full input and output. Show a spinner with elapsed time while the tool executes.

**Community GUI approach**: claude-code-gui renders tool calls as collapsible cards with categorized icons. Results are truncated with "Show more" expansion. Includes copy-to-clipboard for individual cards.

**Complexity**: Medium. Need to match `tool_use` blocks with their corresponding `tool_result` by `tool_use_id`.

### 2.3 Tool Approval / Permission Prompts

**What it does**: When Claude wants to use a tool that requires permission, pause and ask the user to approve or reject.

**CLI behavior**: Shows the tool name and input, presents Allow/Deny buttons with tab navigation between options. "Yes, don't ask again" saves the rule permanently (for bash) or per-session (for file edits).

**SDK mechanism**: The `canUseTool` callback fires when a tool needs approval. Receives `toolName`, `input`, and context including `suggestions` (suggested permission updates) and `decisionReason`. Returns `{ behavior: "allow", updatedInput }` or `{ behavior: "deny", message }`.

**GUI implementation**: When a tool approval is needed, render an inline approval card in the chat with: tool name, command/file details, "Allow" and "Deny" buttons. Optionally include "Always allow" checkbox that maps to `updatedPermissions`. Block further execution until user responds.

**Community GUI approach**: claude-code-gui has a visual allow/deny list for tool permissions. Workspace Trust model requires confirmation for new folders.

**Complexity**: Medium. The `--output-format stream-json` mode emits permission requests as a specific message type that must be responded to via stdin.

### 2.4 User Input & Message Sending

**What it does**: Let the user type prompts and send them to the Claude Code process.

**CLI behavior**: Text input at bottom of terminal. Supports multi-line (`\` + Enter, Option+Enter). `@` triggers file path autocomplete. `!` prefix for bash mode.

**SDK mechanism**: In streaming mode, yield `{ type: "user", message: { role: "user", content: "..." } }` objects. Supports text and image content blocks.

**GUI implementation**: Text input area with send button. Support multi-line input. Ideally support `@` file mentions with autocomplete.

**Complexity**: Low for basic text input. Medium if adding file mentions and autocomplete.

### 2.5 Session Management (Create, Resume, List)

**What it does**: Create new Claude Code sessions, resume existing ones, and list available sessions.

**CLI behavior**: `claude` starts new session. `claude -c` continues most recent. `claude -r <id>` resumes by ID or shows picker. `claude -n <name>` names a session.

**SDK mechanism**: `query()` with a prompt creates a new session. `resume: sessionId` option resumes. `listSessions()` returns session metadata (ID, summary, lastModified, gitBranch, cwd). `getSessionMessages()` reads past transcripts.

**GUI implementation**: In ClaudBan, each card IS a session. Create session on card creation. Resume on chat open. Store `session_id` in the card's database record.

**Complexity**: Low. Core to ClaudBan's existing architecture.

### 2.6 Process Lifecycle Management

**What it does**: Spawn, monitor, and terminate Claude Code child processes.

**CLI behavior**: Process runs until Claude completes its response, then waits for next input. `Ctrl+C` cancels current generation. `Ctrl+D` exits.

**SDK mechanism**: `query()` returns a `Query` object with `interrupt()` to cancel and `close()` to terminate. AbortController can be passed for cancellation.

**GUI implementation**: Spawn via Tauri shell plugin with `--output-format stream-json`. Track process state (active/idle/error). Handle unexpected exits. Provide cancel button that sends interrupt signal.

**Complexity**: Medium. Need robust error handling, process monitoring, and graceful shutdown.

---

## 3. Important Features (Significantly Improve UX)

### 3.1 Permission Mode Switching

**What it does**: Switch between permission modes that control Claude's autonomy level.

**CLI behavior**: `Shift+Tab` cycles through modes. Shows current mode in the prompt bar.

**Modes available**:
| Mode | Key | Behavior |
|---|---|---|
| `default` | Standard | Prompts for each tool on first use |
| `acceptEdits` | Auto-edit | Auto-accepts file edits, still asks for bash commands |
| `plan` | Plan only | Claude analyzes but cannot modify files or run commands |
| `dontAsk` | Strict | Auto-denies unless pre-approved via rules |
| `bypassPermissions` | Full auto | Skips all prompts (dangerous, for sandboxed environments) |

**SDK mechanism**: `query.setPermissionMode(mode)` changes mode mid-session. Initial mode set via `permissionMode` option.

**GUI implementation**: Dropdown or toggle button in the chat panel header showing current mode. Clicking cycles or opens picker. Color-coded indicator (green for auto, yellow for plan, etc.).

**Complexity**: Low. Single dropdown controlling a string value.

### 3.2 Extended Thinking Display

**What it does**: Show Claude's internal reasoning process before it responds.

**CLI behavior**: Thinking content shown in a separate section, often dimmed. Toggle with `Alt+T`. Configurable budget via `/effort` or `MAX_THINKING_TOKENS`.

**SDK mechanism**: `thinking` content blocks appear in `assistant` messages. Configurable via `thinking` option: `{ type: 'adaptive' }` (default), `{ type: 'enabled', budgetTokens }`, or `{ type: 'disabled' }`.

**GUI implementation**: Render thinking blocks as a collapsible section above the response, styled differently (lighter text, italic, or a distinct background). Include a "Show thinking" toggle.

**Community GUI approach**: Not widely implemented in community GUIs.

**Complexity**: Low. Just a different rendering style for `thinking` content blocks.

### 3.3 Context Window Visualization

**What it does**: Show how much of the context window is used and what's consuming space.

**CLI behavior**: `/context` command shows a colored grid visualization. Status line can be configured to show context usage. Auto-compaction triggers at ~95% capacity.

**SDK mechanism**: `compact_boundary` messages include `pre_tokens` count. `result` messages include `usage` with input/output/cache token counts. `status` messages indicate when compaction is happening.

**GUI implementation**: Progress bar or gauge in the chat panel header showing context fill percentage. Color transitions (green -> yellow -> red). Optional breakdown tooltip showing token distribution.

**Complexity**: Medium. Need to track cumulative token usage from `usage` fields in assistant messages.

### 3.4 Cost & Token Tracking

**What it does**: Track and display API costs and token usage.

**CLI behavior**: `/cost` shows total cost, duration (API and wall), and code changes. Status bar can show ongoing costs. `/stats` shows daily usage visualization.

**SDK mechanism**: `result` messages contain `total_cost_usd`, `usage` (input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens), `duration_ms`, `duration_api_ms`, and per-model breakdown in `modelUsage`.

**GUI implementation**: Display in the chat panel footer or header: total cost for session, token counts, and API duration. Could show a running total that updates after each assistant turn.

**Community GUI approach**: claude-code-gui calculates USD costs per session with a 30-day timeline. Shows run summaries with cost, duration, and success/failure status.

**Complexity**: Low. Accumulate values from `result` and `assistant` message `usage` fields.

### 3.5 File Diff Display

**What it does**: Show what files Claude changed and the exact diffs.

**CLI behavior**: `/diff` opens an interactive diff viewer showing uncommitted changes and per-turn diffs. Left/right arrows switch between git diff and individual turns.

**Desktop app**: Full visual diff review with inline comments. Click diff stats indicator (`+12 -1`) to open the viewer. Comment on specific lines, submit all comments at once.

**SDK mechanism**: `Edit` tool calls contain `old_string` and `new_string`. `Write` tool calls contain full `content`. `files_persisted` events confirm file changes. File checkpointing available via `enableFileCheckpointing: true` and `rewindFiles()`.

**GUI implementation**: For each Edit tool call, render a unified diff view showing old_string vs new_string. For Write calls, show the full file content (or flag as "new file"). Group changes by file path.

**Community GUI approach**: claude-code-gui streams tool calls visually and shows file changes.

**Complexity**: High. Requires a diff rendering component. Could use a library like `diff2html` or build a custom one.

### 3.6 Interrupt / Cancel Generation

**What it does**: Stop Claude mid-response.

**CLI behavior**: `Ctrl+C` cancels current generation. `Escape` stops and can trigger rewind.

**SDK mechanism**: `query.interrupt()` (streaming mode). `AbortController` passed via options.

**GUI implementation**: "Stop" button that appears while Claude is generating. Sends interrupt signal to the process.

**Complexity**: Low.

### 3.7 Error Handling & Rate Limits

**What it does**: Display errors and rate limit information gracefully.

**CLI behavior**: Shows error messages inline. Rate limit warnings appear as status messages.

**SDK mechanism**: `SDKAssistantMessageError` types: `authentication_failed`, `billing_error`, `rate_limit`, `invalid_request`, `server_error`, `unknown`. `SDKRateLimitEvent` includes `status` (allowed/warning/rejected), `utilization`, and `resetsAt` timestamp.

**GUI implementation**: Error banners for authentication/billing issues. Rate limit warning with utilization percentage and countdown timer. Retry button for transient errors.

**Complexity**: Low-Medium. Need to handle various error types gracefully.

### 3.8 Compaction Indicator

**What it does**: Show when the conversation is being summarized to free context space.

**CLI behavior**: Shows a "Compacting..." status.

**SDK mechanism**: `status` messages with `status: "compacting"`. `compact_boundary` messages mark the compaction point with trigger type (manual/auto) and pre-compaction token count.

**GUI implementation**: Spinner overlay or inline indicator showing "Compacting context..." when a `status` compacting message arrives. Insert a visual separator at compaction boundaries.

**Complexity**: Low.

---

## 4. Nice-to-Have Features (Polish & Power-User)

### 4.1 Model Switching

**What it does**: Change the AI model mid-session.

**CLI behavior**: `/model` command or `Alt+P` shortcut. Options include `sonnet`, `opus`, `haiku` aliases plus full model names. Left/right arrows adjust effort level in the model picker.

**SDK mechanism**: `query.setModel(model)`. `supportedModels()` returns available models with display info.

**GUI implementation**: Dropdown in chat header showing current model. Populated from `supportedModels()`.

**Complexity**: Low.

### 4.2 Effort Level Control

**What it does**: Control how much reasoning effort Claude applies.

**CLI behavior**: `/effort [low|medium|high|max|auto]`. Persists across sessions (except `max`, session-only).

**SDK mechanism**: `effort` option in query: `'low' | 'medium' | 'high' | 'max'`. Or via `thinking` config.

**GUI implementation**: Slider or segmented control (Low/Medium/High/Max) next to model selector.

**Complexity**: Low.

### 4.3 Slash Command Support

**What it does**: Execute built-in commands and custom skills.

**CLI behavior**: Type `/` to see all commands. Over 50 built-in commands including `/clear`, `/compact`, `/cost`, `/diff`, `/context`, `/model`, `/permissions`, `/resume`, `/rewind`, `/export`, `/fork`, `/btw`, `/plan`, and many more.

**SDK mechanism**: `supportedCommands()` returns available slash commands. Commands sent as regular user messages prefixed with `/`.

**GUI implementation**: Autocomplete popup when user types `/`. Show command name and description. Send as regular message to the process.

**Complexity**: Medium. Need autocomplete UI but commands are just text sent to stdin.

### 4.4 File Mention Autocomplete (@mentions)

**What it does**: Reference files in prompts for Claude to read.

**CLI behavior**: `@` triggers file path autocomplete with fuzzy matching.

**GUI implementation**: When user types `@`, show a file picker/autocomplete dropdown populated from the project directory.

**Complexity**: Medium. Requires file system indexing and fuzzy search.

### 4.5 Image Support

**What it does**: Attach images to prompts for visual analysis.

**CLI behavior**: `Ctrl+V` / `Cmd+V` pastes image from clipboard. Supports image file paths.

**SDK mechanism**: User messages support `image` content blocks with base64-encoded data.

**GUI implementation**: Drag-and-drop images onto the input area. Clipboard paste support. Show image thumbnails in the message.

**Complexity**: Medium. Need file drop handling and base64 encoding.

### 4.6 Background Task Monitoring

**What it does**: Track tasks running in the background.

**CLI behavior**: `Ctrl+B` backgrounds a running command. `Ctrl+T` toggles the task list. Tasks show pending/in-progress/complete status.

**SDK mechanism**: `task_started`, `task_progress`, and `task_notification` messages. `stopTask(taskId)` to stop a task.

**GUI implementation**: Task list panel or badge showing active background tasks. Click to view progress and output.

**Complexity**: Medium.

### 4.7 Checkpointing & Rewind

**What it does**: Track file changes per turn and rewind to previous states.

**CLI behavior**: `Esc+Esc` or `/rewind` opens a scrollable list of past prompts. Options: restore code and conversation, restore conversation only, restore code only, summarize from point.

**SDK mechanism**: `enableFileCheckpointing: true` in options. `query.rewindFiles(userMessageId, { dryRun })` restores files. `files_persisted` events confirm checkpoints.

**GUI implementation**: Timeline or message markers showing checkpoints. Right-click a message to rewind to that point.

**Complexity**: High. Requires tracking file state history and implementing the rewind flow.

### 4.8 Prompt Suggestions

**What it does**: Suggest next prompts based on conversation context.

**CLI behavior**: Grayed-out suggestion appears in the input. Tab to accept, Enter to accept and send.

**SDK mechanism**: Enable `promptSuggestions: true`. Receive `prompt_suggestion` messages with `suggestion` text after each turn.

**GUI implementation**: Ghost text in the input field or a suggestion chip below the input. Click or Tab to accept.

**Complexity**: Low-Medium.

### 4.9 Session Export

**What it does**: Export conversation as text.

**CLI behavior**: `/export [filename]` saves conversation to file or clipboard.

**SDK mechanism**: `getSessionMessages()` reads past transcripts.

**GUI implementation**: Export button in chat header. Save as markdown or plain text.

**Complexity**: Low.

### 4.10 Theme Support

**What it does**: Visual theming for the interface.

**CLI behavior**: `/theme` picks from light/dark variants, colorblind-accessible themes, and ANSI themes. Separate from output styles.

**Community GUI approach**: claude-code-gui has 8 built-in terminal themes (Dracula, Solarized, Nord, Monokai, etc.) plus dark/light toggle.

**GUI implementation**: Dark/light mode toggle. Theme selection for syntax highlighting in code blocks.

**Complexity**: Low-Medium depending on breadth of theme support.

### 4.11 AskUserQuestion UI

**What it does**: Render Claude's clarifying questions as interactive multiple-choice forms.

**CLI behavior**: Questions appear with numbered options. User selects by number.

**SDK mechanism**: `AskUserQuestion` tool call contains `questions[]` array, each with `question`, `header`, `options[]` (label + description + optional preview), and `multiSelect`. Response requires `answers` object mapping question text to selected labels.

**GUI implementation**: Render as a card with radio buttons (single-select) or checkboxes (multi-select). Show option labels and descriptions. Optional "Other" free-text input. Submit button sends the response.

**Complexity**: Medium. Rich interactive form component.

### 4.12 Sub-agent Display

**What it does**: Show when Claude spawns sub-agents and their progress.

**CLI behavior**: Sub-agents run as nested processes. Messages include `parent_tool_use_id` to track hierarchy.

**SDK mechanism**: `Agent` tool calls. Messages from sub-agents have `parent_tool_use_id` set. `SubagentStart`/`SubagentStop` hook events.

**Community GUI approach**: claude-code-gui recursively discovers sub-agent JSONL files in session directories for visibility.

**GUI implementation**: Nested display within the parent tool call card. Show sub-agent name, status, and output.

**Complexity**: High. Requires recursive message tracking.

### 4.13 PR Status Indicator

**What it does**: Show pull request review status.

**CLI behavior**: Footer shows clickable PR link with colored underline (green=approved, yellow=pending, red=changes requested, gray=draft, purple=merged). Updates every 60 seconds.

**Desktop app**: Full CI status bar with auto-fix and auto-merge toggles.

**GUI implementation**: Badge on card or in chat header showing PR status with color coding. Requires `gh` CLI.

**Complexity**: Medium. Requires periodic polling of GitHub via `gh` CLI.

### 4.14 Hook Execution Display

**What it does**: Show when hooks are running and their output.

**SDK mechanism**: `hook_started`, `hook_progress`, and `hook_response` messages.

**GUI implementation**: Small inline indicator when a hook is executing. Expandable to show hook name and output.

**Complexity**: Low.

### 4.15 MCP Server Status

**What it does**: Show status of connected MCP servers.

**SDK mechanism**: `init` system message includes `mcp_servers[]` with name and status. `mcpServerStatus()` returns live status.

**GUI implementation**: Status indicators in settings or session info panel.

**Complexity**: Low.

### 4.16 Verbose/Debug Mode

**What it does**: Show full tool input/output details for debugging.

**CLI behavior**: `Ctrl+O` toggles verbose output showing detailed tool execution.

**GUI implementation**: Toggle in settings that switches tool call cards from summary to full-detail view.

**Complexity**: Low. UI toggle affecting rendering of existing data.

---

## 5. Community GUI Comparison

### claude-code-gui (markes76) - Electron + React

**Stars**: 19 | **Tech**: Electron 31, React 18, TypeScript, Tailwind, Zustand, xterm.js

**Architecture**: Resolves Claude CLI binary, spawns it as `node /path/to/cli.js`, bridges via IPC/PTY. Polls JSONL files from `~/.claude/projects/` for stream data.

**Key Features**:
- Full PTY terminal emulation (xterm.js) + structured Stream view
- Live tool call cards with categorized icons, collapsible details
- USD cost tracking per session with 30-day analytics dashboard
- CLAUDE.md editor (4-level hierarchy: Global, Project, Local, Private)
- Memory browser for auto-memory files (8-level tree view)
- Rules manager for `.claude/rules/*.md` with YAML frontmatter
- Skills, subagents, commands, hooks, MCP server management
- Permissions visual allow/deny list
- Activity trail with location grouping and time-range filtering
- File browser with script execution
- Multiple concurrent session tabs
- 8 color themes + dark/light toggle
- Floating pop-out stream window
- Workspace trust model for new folders

**Unique insight**: Uses a dual-view approach (raw terminal + structured stream) so users can choose their preferred interaction mode. The stream view is the flagship feature.

### claude-gui (badlogic) - WebSocket-based

**Stars**: 4 | **Tech**: TypeScript 100%

**Architecture**: Wraps Claude Code via a bidirectional WebSocket, enabling non-TUI interfaces to connect. Acts as a middleware layer.

**Key insight**: The WebSocket approach is interesting for decoupling the GUI from the CLI process. Any web frontend can connect. Minimal feature set focused on the transport layer.

### leon (MarcZermatten) - Tauri + SvelteKit

**Stars**: Low | **Tech**: Svelte 63%, Rust 22%, TypeScript 14%

**Architecture**: Tauri + SvelteKit desktop app wrapping the CLI. Includes `.claude` configuration directory and MCP integration.

**Key insight**: Closest architecture to ClaudBan (also Tauri-based). Early stage, minimal documentation.

---

## 6. Implementation Notes for ClaudBan

### Priority Matrix for Chat Panel

Based on the research, here is the recommended implementation order for ClaudBan's chat panel:

#### Phase 1: Core Chat (Must Ship)
1. **Message streaming** - Parse `stream-json` output, render assistant/user messages with markdown
2. **Tool call cards** - Collapsible cards for tool_use/tool_result with icon + summary
3. **Permission prompts** - Inline approve/deny for tool confirmation messages
4. **User input** - Text area with send button
5. **Process lifecycle** - Spawn, resume, monitor, kill Claude Code processes

#### Phase 2: Usability
6. **Permission mode selector** - Dropdown in chat header
7. **Thinking display** - Collapsible thinking blocks
8. **Context usage indicator** - Progress bar from token usage
9. **Cost tracking** - Running total from result messages
10. **Error/rate limit handling** - Banners and retry logic
11. **Cancel button** - Interrupt active generation

#### Phase 3: Polish
12. **File diff rendering** - For Edit/Write tool calls
13. **Slash command autocomplete** - `/` prefix triggers command picker
14. **File @mentions** - `@` triggers file autocomplete
15. **AskUserQuestion UI** - Multiple-choice interactive forms
16. **Prompt suggestions** - Ghost text from `prompt_suggestion` messages
17. **Session export** - Save conversation to file

### Key Architecture Decision: stream-json vs SDK

ClaudBan's design spec uses `--output-format stream-json` mode, which is the right choice because:

1. **Full CLI ecosystem**: Skills, hooks, MCP servers, CLAUDE.md all work automatically
2. **Process isolation**: Each session is an independent process via Tauri shell plugin
3. **Resume support**: `--resume <session-id>` reconnects to existing sessions
4. **No API key needed**: Uses the user's existing Claude authentication
5. **Simpler architecture**: No need to embed the SDK; just spawn a process and parse JSON lines

The stream-json format produces the same message types as the SDK (they share the same underlying protocol). The `--include-partial-messages` flag enables real-time streaming text.

### Critical stream-json Input Protocol

To send user messages to a running `--output-format stream-json` process, write newline-delimited JSON to stdin:

```json
{"type":"user","message":{"role":"user","content":"your prompt here"}}
```

For tool approval responses, the format depends on the permission request message type received. The process blocks until the response is sent.

### Recommended Libraries

| Purpose | Library | Notes |
|---|---|---|
| Markdown rendering | `marked` or `markdown-it` | Vue-compatible, fast |
| Syntax highlighting | `shiki` or `highlight.js` | For code blocks in messages |
| Diff rendering | `diff2html` | For Edit tool call visualization |
| JSON streaming parser | Custom line-based parser | Split on `\n`, `JSON.parse()` each line |
