# ClaudBan - Implementation Tasks

**Feature**: ClaudBan - Claude Code Session Kanban Manager
**Generated from**: spec (2026-03-15-claudban-design.md), plan (2026-03-15-claudban-implementation.md)
**Date**: 2026-03-15

## User Stories (derived from spec)

| ID | Story | Priority |
|----|-------|----------|
| US1 | As a user, I can manage projects (add/remove directories) and switch between them via tabs | P1 |
| US2 | As a user, I can see a Kanban board with configurable columns for my project | P1 |
| US3 | As a user, I can create Claude Code sessions as cards and see them on the board | P1 |
| US4 | As a user, I can open a card to chat with a Claude Code session in a split panel | P1 |
| US5 | As a user, I can drag cards between columns and trigger pipeline prompts automatically | P2 |
| US6 | As a user, I can configure columns and pipeline prompt templates per project | P2 |
| US7 | As a user, I can configure global app settings (claude binary path, theme) | P3 |

## Dependencies

```
US1 (Projects) ──> US2 (Board) ──> US3 (Sessions) ──> US4 (Chat)
                                        │
                                        └──> US5 (Pipelines)
US6 (Settings: Project) - independent after US2
US7 (Settings: Global) - independent after Phase 1
```

---

## Phase 1: Setup

- [ ] T001 Scaffold Tauri v2 + Vue 3 + TypeScript project with `pnpm create tauri-app` in project root
- [ ] T002 Install dependencies: pinia, vue-draggable-plus, js-yaml, uuid, @types/js-yaml, @types/uuid
- [ ] T003 Install Tauri plugins: tauri-plugin-shell, tauri-plugin-sql (sqlite), tauri-plugin-dialog, tauri-plugin-fs
- [ ] T004 Register all Tauri plugins in `src-tauri/src/lib.rs`
- [ ] T005 Configure capabilities/permissions in `src-tauri/capabilities/default.json` (shell:spawn, sql:load/execute/select, dialog:open, fs:read/write/exists/mkdir)
- [ ] T006 Verify app builds and opens empty window with `pnpm tauri dev`
- [ ] T007 Commit: "feat: scaffold Tauri v2 + Vue 3 project with plugins"

## Phase 2: Foundation (types, services, stores)

- [ ] T008 [P] Define all TypeScript interfaces in `src/types/index.ts`: Project, Card, CardState, ColumnConfig, PipelineConfig, ProjectConfig, GlobalSettings, StreamMessage (with tool_confirmation type and sessionId field), TemplateContext
- [ ] T009 [P] Create database service in `src/services/database.ts`: getDb(), runMigrations() (projects + cards tables), insertProject, getAllProjects, updateProjectLastOpened, deleteProject, getCardsByProject, insertCard, updateCard, deleteCard, updateCardsColumn
- [ ] T010 [P] Create config loader in `src/services/config-loader.ts`: loadProjectConfig(), createDefaultConfig() (6 default columns + 2 default pipelines), saveProjectConfig(), validateConfig() (unique columns, valid pipeline refs, no duplicate transitions)
- [ ] T011 [P] Create template engine in `src/services/template-engine.ts`: resolveTemplate() with {{group.key}} regex replacement using TemplateContext
- [ ] T012 [P] Create stream parser in `src/services/stream-parser.ts`: parseStreamLine() handling assistant, user, tool_use, tool_result, system (with sessionId extraction), tool_confirmation/permission_request types
- [ ] T013 Create Claude process manager in `src/services/claude-process.ts`: setupCommand() shared helper, checkClaudeBinary(), spawnClaudeSession(), resumeClaudeSession(), sendMessage(), updateSessionId(), killProcess(), isProcessActive()
- [ ] T014 Commit: "feat: add foundation services (database, config, claude process, template engine, stream parser)"
- [ ] T015 [P] Create settings Pinia store in `src/stores/settings.ts`: load/save ~/.claudban/settings.yaml, updateClaudePath()
- [ ] T016 [P] Create projects Pinia store in `src/stores/projects.ts`: load, addProject, removeProject, setActive, activeProject computed
- [ ] T017 [P] Create pipelines Pinia store in `src/stores/pipelines.ts`: loadForProject, getConfig, findPipeline, saveConfig (uses Map keyed by project path)
- [ ] T018 Create cards Pinia store in `src/stores/cards.ts`: cardsByColumn (sort by columnOrder then lastActivityAt), loadForProject, addCard, moveCard, updateCardState, updateCardSessionId, reorderColumn, removeCard
- [ ] T019 Create sessions Pinia store in `src/stores/sessions.ts`: messages Map, activeChatCardId, claudeAvailable/claudeError refs, verifyClaudeBinary(), startSession() (with sessionId detection from stream), resumeSession(), send(), stopSession(), openChat(), closeChat()
- [ ] T020 Commit: "feat: add Pinia stores (settings, projects, pipelines, cards, sessions)"

## Phase 3: Project Management [US1]

- [ ] T021 [US1] Create global CSS dark theme in `src/assets/main.css`: CSS variables (--bg-primary, --bg-secondary, --bg-tertiary, --text-primary, --text-secondary, --text-muted, --border, --accent, --success, --warning, --error), scrollbar styling, body/button/input resets
- [ ] T022 [US1] Update `src/main.ts`: import createPinia, import main.css, mount with Pinia
- [ ] T023 [US1] Create TabBar component in `src/components/TabBar.vue`: project tabs loop, active state styling, switchProject() loading cards + pipelines, addProject() with native directory picker via @tauri-apps/plugin-dialog, settings button
- [ ] T024 [US1] Create App.vue shell in `src/App.vue`: TabBar, main-content area with board-area + ChatPanel, onMounted loading settings/projects/cards/pipelines, showChat computed
- [ ] T025 [US1] Verify: open app, click "+" tab, select directory, tab appears
- [ ] T026 [US1] Commit: "feat: add project management with tabs and directory picker"

## Phase 4: Kanban Board [US2]

- [ ] T027 [US2] Create StatusIndicator component in `src/components/StatusIndicator.vue`: green (active), gray (idle), red (error) dots with pulse animation for active
- [ ] T028 [US2] Create KanbanCard component in `src/components/KanbanCard.vue`: card name, description, status indicator, timeAgo helper, tags display, click to openChat
- [ ] T029 [US2] Create NewSessionDialog component in `src/components/NewSessionDialog.vue`: modal overlay, name input (required), description input (optional), create/cancel buttons, Enter key support
- [ ] T030 [US2] Create KanbanColumn component in `src/components/KanbanColumn.vue`: column header (color dot, name, card count, "+" button), v-draggable body with group "kanban", onAdd handler (detect card move, trigger pipeline), onUpdate handler (reorder within column), createSession handler
- [ ] T031 [US2] Create KanbanBoard component in `src/components/KanbanBoard.vue`: horizontal flex container, iterate columns from pipelinesStore config
- [ ] T032 [US2] Verify: board renders with default 6 columns, can create cards, drag between columns
- [ ] T033 [US2] Commit: "feat: add Kanban board with columns, cards, and drag-drop"

## Phase 5: Chat & Sessions [US3 + US4]

- [ ] T034 [US3] Create ChatMessage component in `src/components/ChatMessage.vue`: assistant bubble (left, dark bg), user bubble (right, accent bg), system message (centered, muted italic)
- [ ] T035 [US3] Create ToolCallBlock component in `src/components/ToolCallBlock.vue`: collapsed/expanded toggle, tool name + badge, tool_confirmation type with approve/reject buttons sending "y"/"n" via sessionsStore.send(), tool input/result pre blocks
- [ ] T036 [US4] Create ChatPanel component in `src/components/ChatPanel.vue`: header (session name, phase badge, close button), messages container with auto-scroll, render ChatMessage/ToolCallBlock by type, text input with Enter-to-send, auto-resume idle sessions on first message
- [ ] T037 [US4] Wire ChatPanel into App.vue with conditional rendering based on showChat
- [ ] T038 [US3] Verify: create session, card appears with green dot, chat panel opens, can send messages, Claude responds, tool calls render collapsed
- [ ] T039 [US4] Verify: close chat panel, card still shows green dot (process running), reopen card chat, messages preserved
- [ ] T040 [US3] Commit: "feat: add chat panel with Claude Code session integration"

## Phase 6: Pipeline Triggers [US5]

- [ ] T041 [US5] Wire pipeline trigger in KanbanColumn.vue onAdd handler: detect from-column, lookup pipeline via pipelinesStore.findPipeline(), auto-resume idle session, resolve template variables, send prompt, open chat panel
- [ ] T042 [US5] Verify: configure pipeline (Brainstorm->Specify), create card in Brainstorm, drag to Specify, pipeline prompt fires and appears in chat
- [ ] T043 [US5] Verify: drag card with idle session triggers auto-resume then pipeline
- [ ] T044 [US5] Commit: "feat: add pipeline trigger on card column transitions"

## Phase 7: Project Settings [US6]

- [ ] T045 [P] [US6] Create ColumnEditor component in `src/components/ColumnEditor.vue`: color picker + name input per column, add/remove/reorder, emit column-removed (for card migration) and column-renamed (for pipeline ref updates)
- [ ] T046 [P] [US6] Create PipelineEditor component in `src/components/PipelineEditor.vue`: from/to column selects, prompt textarea with monospace font, variables help display, add/remove pipelines
- [ ] T047 [US6] Create ProjectSettings component in `src/components/ProjectSettings.vue`: modal overlay, project path display, ColumnEditor + PipelineEditor, handle column-removed (migrate cards to first column, remove affected pipelines), handle column-renamed (update pipeline from/to refs and card columnName)
- [ ] T048 [US6] Wire ProjectSettings button in TabBar.vue (settings button next to active tab)
- [ ] T049 [US6] Verify: open settings, rename column, pipelines update; delete column with cards, cards migrate; add pipeline, drag card triggers it
- [ ] T050 [US6] Commit: "feat: add project settings with column and pipeline editors"

## Phase 8: Global Settings & Polish [US7]

- [ ] T051 [US7] Create GlobalSettings component in `src/components/GlobalSettings.vue`: claude binary path input with live validation (checkClaudeBinary), status badge (Found/Not found), error message guidance
- [ ] T052 [US7] Wire GlobalSettings access point in TabBar or App.vue
- [ ] T053 Add draggable split panel divider in `src/App.vue`: mousedown/mousemove handler, chatWidth ref (320-600px range), divider element between board and ChatPanel, remove CSS resize:horizontal from ChatPanel
- [ ] T054 [US7] Commit: "feat: add global settings and resizable split panel divider"

## Phase 9: Polish & Cross-Cutting

- [ ] T055 Configure Tauri shell plugin scope in `src-tauri/capabilities/default.json` for claude binary execution (allow "claude" command and custom paths)
- [ ] T056 Add .gitignore: node_modules/, src-tauri/target/, dist/, .superpowers/
- [ ] T057 End-to-end smoke test: add project -> create session -> chat -> drag card -> pipeline fires -> settings work -> close/reopen chat
- [ ] T058 Run production build with `pnpm tauri build`, verify bundle output in `src-tauri/target/release/bundle/`
- [ ] T059 Final commit: "feat: ClaudBan v0.1.0 - Claude Code session Kanban manager"

---

## Parallel Execution Opportunities

| Phase | Parallel Tasks | Notes |
|-------|---------------|-------|
| Phase 2 | T008, T009, T010, T011, T012 | All independent service/type files |
| Phase 2 | T015, T016, T017 | Settings, projects, pipelines stores (no interdependency) |
| Phase 4 | T027, T028, T029 | Independent components |
| Phase 5 | T034, T035 | ChatMessage and ToolCallBlock are independent |
| Phase 7 | T045, T046 | ColumnEditor and PipelineEditor are independent |

## Implementation Strategy

- **MVP**: Phases 1-5 (T001-T040) deliver a working app: projects, board, sessions, chat
- **Feature-complete**: Phases 6-8 (T041-T054) add pipelines, settings, polish
- **Release-ready**: Phase 9 (T055-T059) integration testing and build

## Metrics

- **Total tasks**: 59
- **Setup**: 7 tasks
- **Foundation**: 13 tasks
- **US1 (Projects)**: 6 tasks
- **US2 (Board)**: 7 tasks
- **US3+US4 (Chat/Sessions)**: 7 tasks
- **US5 (Pipelines)**: 4 tasks
- **US6 (Project Settings)**: 6 tasks
- **US7 (Global Settings)**: 4 tasks
- **Polish**: 5 tasks
- **Parallel opportunities**: 15 tasks marked [P]
- **Suggested MVP scope**: Phases 1-5 (US1-US4), 40 tasks
