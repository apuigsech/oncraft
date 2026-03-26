# Product Ready — Implementation Plan

**Spec:** `docs/specs/product-ready-spec.md`
**Date:** 2026-03-26
**Status:** Draft

---

## Plan Strategy

This spec is too large for a single implementation pass. It is divided into **8 phases**, ordered so that each phase builds on the previous one and delivers testable, self-contained value.

**Dependency graph:**

```
Phase 1 (Foundations)
  ├── Phase 2 (Chat Bug Fixes) [independent of 3-5]
  ├── Phase 3 (Navigation Rework)
  │     └── Phase 4 (Home Screen + Onboarding)
  │     └── Phase 5 (Settings Rework)
  ├── Phase 6 (Kanban Card Improvements) [depends on Phase 2]
  └── Phase 7 (Telemetry)
Phase 8 (Distribution & Release) [depends on all above]
```

Phases 2, 3, and 6 can be worked in parallel after Phase 1 completes (Phase 6 needs Phase 2 for reliable state sync).

---

## Phase 1 — Foundations

**Goal:** Establish the infrastructure that all subsequent phases depend on: Nuxt UI migration, error handling, theme system, testing framework, license, and README.

**Covers:** REQ-UI-1, REQ-UI-2, REQ-UI-6, REQ-ERR-1 through REQ-ERR-4, REQ-TEST-1, REQ-LIC-1, REQ-README-1

### Step 1.1 — Nuxt UI Theme & Design Tokens

Define the custom [ProductName] theme for Nuxt UI. This is foundational — every component in subsequent phases will use this theme.

**Files to create/modify:**
- `app/app.config.ts` — Nuxt UI theme configuration (colors, radii, shadows, component defaults)
- `app/assets/main.css` — Update CSS custom properties to align with Nuxt UI theme tokens
- `app/assets/theme.css` — May be consolidated into `app.config.ts` or kept for non-Nuxt-UI styles

**Acceptance:** The app renders with the new cohesive theme. All existing Nuxt UI components (UButton, UBadge, UChatMessages, etc.) pick up the new design tokens.

### Step 1.2 — Global Error Handling

**Files to create/modify:**
- `app/plugins/error-handler.ts` — New Nuxt plugin. Registers `app.config.errorHandler`, `window.onerror`, `window.onunhandledrejection`. Logs locally, dispatches to telemetry service (no-op until Phase 7).
- `app/components/ErrorBoundary.vue` — New component. Wraps children with `onErrorCaptured`, shows fallback UI with retry button on crash.
- `app/app.vue` — Wrap `KanbanBoard`, `ChatPanel`, `ConsolePanel` areas with `ErrorBoundary`.

**Acceptance:** A thrown error in a component shows the fallback UI instead of a blank screen. Unhandled promises are caught and logged.

### Step 1.3 — Nuxt UI Migration of All Dialogs

Migrate every component that uses native HTML interactive elements to Nuxt UI equivalents. This is mechanical but large.

**Files to modify:**
- `app/components/NewSessionDialog.vue` — Replace native `<button>`, `<input>`, `<textarea>`, `<label>` with `UButton`, `UInput`, `UTextarea`, `UFormField`. Replace custom overlay with `UModal`.
- `app/components/EditCardDialog.vue` — Same migration. Replace `<button>`, `<input>` with Nuxt UI. Replace overlay with `UModal`.
- `app/components/CardContextMenu.vue` — Replace custom context menu with `UContextMenu` or `UDropdownMenu`. Replace native `<button>` items.
- `app/components/ProjectSettings.vue` — Replace `<button>`, `<input>` with `UButton`, `UInput`. Replace overlay with `UModal`.
- `app/components/GlobalSettings.vue` — Replace `<button>` with `UButton`. Replace overlay with `UModal`.
- `app/components/KanbanColumn.vue` — Replace inline dialogs (required-files, close-issues) with `UModal`. Replace native `<button>`, `<input>` elements.
- `app/components/KanbanCard.vue` — Replace `confirm()` in `handleDelete` with `UModal` confirmation dialog.
- `app/components/FileViewer.vue` — Audit and migrate any native elements.
- `app/components/ImportSessionsDialog.vue` — Audit and migrate.
- `app/components/IssueSelector.vue` — Audit and migrate.

**Acceptance:** Zero native `<button>`, `<input>`, `<select>`, `<checkbox>` elements in any component. Zero `confirm()` calls. All dialogs use `UModal`.

### Step 1.4 — Loading States & Transitions

**Files to create/modify:**
- `app/components/AppSplash.vue` — New component. Branded loading screen shown during app initialization.
- `app/components/KanbanSkeleton.vue` — New component. Skeleton loader for the Kanban board area.
- `app/components/ChatSkeleton.vue` — New component. Skeleton loader for chat history.
- `app/app.vue` — Show `AppSplash` during store initialization. Add transitions for tab switching, chat panel open/close.
- `app/components/KanbanBoard.vue` — Show `KanbanSkeleton` while columns load.
- `app/components/ChatPanel.vue` — Show `ChatSkeleton` while history loads.

**Acceptance:** App shows branded splash on startup. Kanban and chat show skeletons during load. Tab switching and chat open/close have smooth transitions.

### Step 1.5 — Empty States

**Files to create/modify:**
- `app/components/EmptyState.vue` — New reusable component. Takes icon, title, description, CTA props.
- `app/components/KanbanColumn.vue` — Use `EmptyState` when column has no cards.
- `app/components/ChatPanel.vue` — Use `EmptyState` for empty chat.
- `app/app.vue` — Use `EmptyState` when no projects are open (this will evolve into Home in Phase 4).

**Acceptance:** All empty states show a designed component with icon, hint text, and CTA — no plain text.

### Step 1.6 — Testing Framework Setup

**Files to create/modify:**
- `vitest.config.ts` — New. Configure Vitest for the frontend (with Nuxt environment).
- `package.json` — Add vitest, @vue/test-utils as dev dependencies. Add `test` script.
- `app/services/__tests__/stream-parser.test.ts` — New. Tests for JSON line parsing.
- `app/services/__tests__/chat-part-registry.test.ts` — New. Tests for message type → component mapping.
- `app/services/__tests__/database.test.ts` — New. Tests for migration idempotency, CRUD, case conversion.
- `app/services/__tests__/flow-loader.test.ts` — New. Tests for preset loading, merge, state order.

**Acceptance:** `pnpm test` runs and passes. Critical path services have test coverage.

### Step 1.7 — License & README

**Files to create:**
- `LICENSE` — FSL license text with Apache 2.0 conversion after 2 years.
- `README.md` — Product description, screenshots placeholder, requirements, install instructions, quick start, license summary. Uses `[ProductName]` placeholder.

**Acceptance:** Both files exist at repo root with complete content.

---

## Phase 2 — Chat Bug Fixes & Improvements

**Goal:** Fix all chat reliability issues and add missing feedback indicators.

**Covers:** REQ-CHAT-1 through REQ-CHAT-9

**Depends on:** Phase 1 (Nuxt UI components available for tool widgets)

### Step 2.1 — Tool Approval Verification & Fix

Verify whether the `updatedInput` bug is resolved with SDK 0.2.84. If not, fix it.

**Files to modify:**
- `src-sidecar/agent-bridge.ts` — Verify/fix `canUseTool` callback `updatedInput` handling.

**Acceptance:** Tool approval (Allow/Deny) works reliably for all tool types (Bash, MCP, Read, etc.).

### Step 2.2 — Tool Widget Visual Consistency

**Files to modify:**
- `app/components/ToolCallBlock.vue` — Ensure post-decision tool blocks render with the same style as pending tool blocks.
- `app/services/chat-part-registry.ts` — Verify that `tool_confirmation` resolved state maps to the same component/style as `tool_use`.

**Acceptance:** Tool blocks look identical whether they're pending approval, approved, or denied.

### Step 2.3 — Thinking/Reasoning Blocks Fix

The code already has infrastructure for thinking blocks: `useUIMessages.ts` maps thinking parts to `type: 'reasoning'`, and `ChatPanel.vue` renders `UChatReasoning` for reasoning parts. This may already work. Verify first, fix only if needed.

**Files to verify/modify:**
- `src-sidecar/agent-bridge.ts` — Verify thinking events (`thinking` in assistant content blocks, `thinking_delta` in stream events) are emitted with the correct structure.
- `app/services/chat-part-registry.ts` — Verify thinking message type registration.
- `app/composables/useUIMessages.ts` — Verify thinking parts translate to `type: 'reasoning'` for `UChatMessages`.
- `app/components/ChatPanel.vue` — Verify `UChatReasoning` renders correctly at line 377-382.

**Acceptance:** Thinking blocks render using `UChatReasoning` with auto-open during streaming and auto-close after. If already working, document the verification.

### Step 2.4 — Agent Activity Indicator & Sub-Agent Feedback

**Files to modify:**
- `app/components/AgentProgressBar.vue` — Enhance to show a persistent, unambiguous activity indicator when the agent is working. Add sub-agent count display.
- `src-sidecar/agent-bridge.ts` — Ensure `task_started`, `task_progress` messages for sub-agents are properly emitted.
- `app/services/chat-part-registry.ts` — Register sub-agent message types if not already.
- `app/stores/sessions.ts` — Track sub-agent count per card.

**Acceptance:** A clear visual indicator is always visible when the agent is active. Sub-agent count shows when applicable. The user never wonders if the agent is alive.

### Step 2.5 — Input State Synchronization

`isActive` already derives from `isQueryActive()` in `claude-process.ts`, which tracks active queries via an `activeQueries` Set. The real bug is that `markQueryComplete()` / `activeQueries.delete()` is not called reliably in all edge cases.

**Files to modify:**
- `app/services/claude-process.ts` — Audit all code paths where the sidecar process can end (normal result, error, interrupt, abort, sidecar crash/exit, `close` event). Ensure `markQueryComplete(cardId)` is called in every case. Add sidecar process exit handler (`command.on('close')`) as a safety net.
- `app/stores/sessions.ts` — No changes expected (already uses `isQueryActive`), but verify edge cases in `send()` and `interruptSession()`.

**Acceptance:** Input is always disabled when processing, always enabled when done. No manual card switching needed to recover.

### Step 2.6 — MCP Bridge Reliability

**Files to modify:**
- `app/services/claude-process.ts` — In `handleSessionRequest`, make card lookup robust: use a stable `cardId → card` mapping that survives store reloads. Add diagnostic error messages when card not found (include cardId, store size, process status).
- `app/stores/cards.ts` — Ensure `loadForProject` doesn't wipe cards that have active processes.

**Acceptance:** MCP tools (`get_current_card`, `update_current_card`, `get_project`) work reliably throughout a session, including across column transitions and store reloads.

### Step 2.7 — Toolbar Submit Bug Fix

The root cause is the native `<button>` elements in the effort level bar (`InputToolbar.vue` lines 116-123) which lack `type="button"`. Inside `UChatPrompt`'s `#footer` slot, they default to `type="submit"` and trigger form submission.

**Files to modify:**
- `app/components/InputToolbar.vue` — Add `type="button"` to all native `<button>` elements in the effort bar. These will also be migrated to `UButton` in Phase 1 Step 1.3, which will inherently fix this, but the explicit `type="button"` fix should be applied first as a quick bugfix.

**Acceptance:** Changing model, effort, or permission mode with text in the input does NOT send the message.

### Step 2.8 — Markdown HTML Rendering Fix

The root cause is in `markdown.ts`: the `codespan` renderer wraps `text` in `<code>` without HTML-escaping. When `text` contains `<button>`, it renders as an actual HTML element. The fenced `code` block renderer may be safe if `hljs.highlight()` already escapes HTML, but must be verified.

**Files to modify:**
- `app/services/markdown.ts` — HTML-escape the `text` parameter in the `codespan` renderer (e.g. replace `<` with `&lt;`, `>` with `&gt;`). Verify the `code` renderer (fenced blocks) also escapes HTML correctly.

**Acceptance:** Messages containing inline code with HTML tags (e.g. `` `<button>` ``) display correctly as literal text, not rendered HTML.

---

## Phase 3 — Navigation Rework

**Goal:** Implement the new tab bar with pinned Home/Settings tabs, draggable project tabs, activity indicators, and per-project active chat.

**Covers:** REQ-NAV-1 through REQ-NAV-7

**Depends on:** Phase 1 (Nuxt UI components, theme)

### Step 3.1 — Tab Bar Redesign with Pinned Tabs

**Files to modify:**
- `app/components/TabBar.vue` — Major rework. Add Home tab (icon-only, house icon, always first, non-closable). Add Settings tab (icon-only, gear icon, always second, non-closable). Project tabs open to the right. Keep "+" button. Remove `@open-settings` and `@open-global-settings` event emissions — these are replaced by tab-based routing.
- `app/app.vue` — Add `activeTab` state that can be `'home'`, `'settings'`, or a project ID. Route rendering based on active tab type. Remove `showSettings` and `showGlobalSettings` refs and the event listeners from TabBar.
- `app/stores/projects.ts` — May need to track tab order separately from project list.

**Acceptance:** Tab bar shows Home and Settings as pinned icon tabs, followed by project tabs and "+". Home is active when no projects are open.

### Step 3.2 — Draggable Project Tabs

**Files to modify:**
- `app/components/TabBar.vue` — Add drag-and-drop to project tabs using the existing `vue-draggable-plus` dependency. Pinned tabs must not be draggable.
- `app/stores/projects.ts` — Persist tab order in SQLite or settings YAML.

**Acceptance:** Project tabs can be reordered by dragging. Order persists across restarts. Pinned tabs stay fixed.

### Step 3.3 — Tab Activity Indicator

**Files to modify:**
- `app/components/TabBar.vue` — Add activity dot/animation to project tabs based on active card state within that project.
- `app/stores/sessions.ts` or `app/stores/cards.ts` — Expose a computed `hasActiveCards(projectId)` that checks real sidecar state.

**Acceptance:** Project tabs show a visible active indicator when any card in the project has a running agent. Indicator disappears when all cards are idle.

### Step 3.4 — Per-Project Active Chat

**Files to modify:**
- `app/stores/sessions.ts` — Replace global `activeChatCardId` with `activeChatCardByProject: Map<string, string>`. Add `openChat(cardId)` and `closeChat()` that operate on the current project. Add computed `activeChatCardId` that derives from `activeProjectId`.
- `app/app.vue` — Update `showChat` computed to use per-project active chat.
- `app/components/ChatPanel.vue` — No changes needed IF the computed getter remains named `activeChatCardId` (verify all 6+ references).
- `app/components/ConsolePanel.vue` — Verify all 8 references to `sessionsStore.activeChatCardId` still work with the derived computed.
- `app/components/KanbanCard.vue` — No changes needed (already calls `sessionsStore.openChat`).

**Acceptance:** Switching between project tabs restores the chat that was open in each project. Restarting the app starts with no chats open.

---

## Phase 4 — Home Screen & Onboarding

**Goal:** Build the Home screen with its four content blocks and the first-run onboarding wizard.

**Covers:** REQ-HOME-1, REQ-HOME-2, REQ-ONB-1 through REQ-ONB-4

**Depends on:** Phase 3 (tab bar with Home tab routing)

### Step 4.1 — Home Screen Component & Layout

**Files to create/modify:**
- `app/components/HomeScreen.vue` — New component. Grid/flex layout for the four blocks.
- `app/app.vue` — Render `HomeScreen` when active tab is `'home'`.

**Acceptance:** Home screen renders when Home tab is clicked, with placeholder content for the four blocks.

### Step 4.2 — Recent Projects Block

**Files to modify:**
- `app/components/HomeScreen.vue` — Implement Block 1. Read from `projectsStore.projects`. Show name, path, active card count, last activity. Click to open as tab. "Open new project" button. Warning for projects whose path doesn't exist on disk.
- `app/stores/projects.ts` — May need to add last activity timestamp and active card count computeds.
- `app/services/database.ts` — May need a cross-project query for active cards per project.

**Acceptance:** Recent projects display with accurate metadata. Click opens the project. Missing-on-disk projects show warning.

### Step 4.3 — Global Activity Block

**Files to modify:**
- `app/components/HomeScreen.vue` — Implement Block 2. Query all active cards across all projects. Show card name, project name, flow state, running duration.
- `app/services/database.ts` — Add query to fetch active cards across all projects.
- `app/stores/sessions.ts` — May need to expose sidecar process tracking for duration calculation.

**Acceptance:** Shows all currently active cards. Clicking an entry opens the project and focuses the card's chat.

**Implementation note for cross-project navigation:** Clicking an entry requires a multi-step async flow that doesn't exist yet: `projectsStore.setActive(projectId)` → `await cardsStore.loadForProject(projectId)` → `await pipelinesStore.loadForProject(projectPath)` → `sessionsStore.openChat(cardId)`. This should be extracted into a reusable `navigateToCard(projectId, cardId)` function in `app.vue` or a composable.

### Step 4.4 — Usage Metrics Block

**Files to modify:**
- `app/components/HomeScreen.vue` — Implement Block 3. Show cost (today/week/month), tokens, session count.
- `app/services/database.ts` — Add aggregation queries: `SUM(cost_usd)` with date filters, `COUNT(*)` for sessions, `SUM(input_tokens)` / `SUM(output_tokens)`.

**Acceptance:** Metrics display with accurate, up-to-date numbers sourced from the database.

### Step 4.5 — System Health Block

**Files to create/modify:**
- `app/services/health-check.ts` — New service. Detects Claude CLI (installed, version), API key (configured), gh CLI (installed, authenticated), sidecar status. Returns structured health data.
- `app/components/HomeScreen.vue` — Implement Block 4. Show each check item with green/amber/red indicator.

**Acceptance:** Health check displays accurate status for all prerequisites with appropriate color indicators.

### Step 4.6 — Onboarding Wizard

The onboarding must be built early so the full new-user flow can be tested. The telemetry opt-in checkbox in Step 1 is a UI element only at this stage — it will be wired to the real telemetry service in Phase 7.

**Files to create/modify:**
- `app/components/OnboardingWizard.vue` — New component. 3-step wizard: Welcome (with telemetry opt-in checkbox, initially just persists preference), Prerequisite Check (reuse `health-check.ts` from Step 4.5), Open First Project.
- `app/stores/settings.ts` — Add `onboardingCompleted`, `onboardingDismissed`, and `telemetryEnabled` fields to `GlobalSettings` type in `app/types/index.ts` and `DEFAULT_SETTINGS` in `settings.ts`.
- `app/app.vue` — Show `OnboardingWizard` on first launch (check settings). After completion, show Home.

**Acceptance:** First launch shows onboarding. "Don't show again" persists. After onboarding, lands on Home. Telemetry preference is stored (wired to real service in Phase 7).

---

## Phase 5 — Settings Rework

**Goal:** Implement the full-screen Global Settings tab and upgrade Project Settings.

**Covers:** REQ-SET-1 through REQ-SET-3, REQ-PSET-1 through REQ-PSET-3

**Depends on:** Phase 3 (tab bar with Settings tab routing), Phase 1 (Nuxt UI)

### Step 5.1 — Global Settings Full-Screen Layout

**Files to create/modify:**
- `app/components/GlobalSettingsPage.vue` — New component. Replaces the old `GlobalSettings.vue` modal. Full-screen layout with left sidebar (section navigation) and main content area.
- `app/app.vue` — Render `GlobalSettingsPage` when active tab is `'settings'`.
- `app/components/GlobalSettings.vue` — Remove or repurpose.

**Acceptance:** Settings tab renders a full-screen page with sidebar navigation.

### Step 5.2 — General Settings Section

**Files to modify:**
- `app/types/index.ts` — Add `defaultModel`, `defaultEffort` fields to `GlobalSettings` interface.
- `app/stores/settings.ts` — Add new fields to `DEFAULT_SETTINGS`. Ensure save-on-change.
- `app/components/GlobalSettingsPage.vue` — Implement General section: theme (dark/light toggle), chat mode (integrated/console), default model, default effort level.

**Acceptance:** All General settings are editable and persist immediately.

### Step 5.3 — Telemetry Settings Section

**Files to modify:**
- `app/components/GlobalSettingsPage.vue` — Implement Telemetry section: opt-in/out toggle, "What do we collect?" expandable, "View telemetry data" button (placeholder until Phase 7).

**Acceptance:** Toggle exists and persists. Expandable explanation shows the data collection policy.

### Step 5.4 — System & About Sections

**Files to modify:**
- `app/components/GlobalSettingsPage.vue` — Implement System section (reuse `health-check.ts` from Phase 4 with "Check again" button). Implement About section: app version (from `package.json`), FSL license info, changelog link, download link (placeholder).

**Acceptance:** System shows health status with re-check. About shows version and license.

### Step 5.5 — Project Settings Upgrade

**Files to modify:**
- `app/components/ProjectSettings.vue` — Migrate fully to Nuxt UI. Ensure it remains as modal/panel (not full-screen). All native elements replaced.

**Acceptance:** Project Settings uses 100% Nuxt UI components. Opens as overlay. All existing functionality preserved.

---

## Phase 6 — Kanban Card Improvements

**Goal:** Enhance the card component with better status indicators, quick actions, file picker, and git-status colors.

**Covers:** REQ-CARD-1 through REQ-CARD-6

**Depends on:** Phase 1 (Nuxt UI migration), Phase 2 (reliable state sync — needed for REQ-CARD-1)

**Dependency graph within Phase 6:**

```
Step 6.1 (StatusIndicator) ──┐
                              ├── Step 6.2 (Quick Actions) ── uses StatusIndicator + interrupt APIs
Step 6.4 (Git Status backend) ┤
                              └── Step 6.3 (FilePicker) ── independent
Step 6.5 (Verification) ──────── after all above
```

Steps 6.1 and 6.4-backend can be done first (independent). Step 6.2 builds on 6.1. Step 6.3 is independent. Step 6.5 is verification after everything.

---

### Step 6.1 — Enhanced Status Indicator (REQ-CARD-1)

**Current state:** `StatusIndicator.vue` renders an 8×8px dot. `active` has a pulse animation, `completed` is transparent (invisible). The card passes `card.state` directly as prop, which is already kept in sync with the sidecar via `session_state_changed` events in `sessions.ts:handleMeta()` (line ~194) and `result` events (line ~174).

**What to do:**

1. **Redesign `StatusIndicator.vue`** — Replace the 8px dot with a 12×12px indicator that uses distinct visuals per state:
   - `active` — Green filled circle with animated pulse ring (expanding concentric ring animation, not just opacity pulse). Use `var(--success)` color.
   - `idle` — Gray outline circle (no fill, border only). Use `var(--text-muted)`.
   - `error` — Red filled circle with `!` or solid red dot. Use `var(--error)`.
   - `completed` — Green checkmark icon (✓) instead of invisible. Use `var(--success)`.
   The component should accept an optional `size` prop (`'sm' | 'md'`, default `'md'`) for future flexibility.

2. **Update `KanbanCard.vue`** — The existing `<StatusIndicator :state="card.state" />` at line 183 is correct. Phase 2 already ensures `card.state` reflects real sidecar state via `session_state_changed` events. No change needed here unless Phase 2 introduced a computed property (verify at implementation time).

**Files to modify:**
- `app/components/StatusIndicator.vue` — Full redesign: new template with SVG/CSS-based indicators per state, animated pulse ring for active, checkmark for completed.

**Acceptance:**
- Indicator is 12px wide, clearly visible in the card header.
- Active cards show animated green pulse ring.
- Idle cards show muted gray outline.
- Error cards show red filled dot.
- Completed cards show green checkmark.
- State changes propagated by the sidecar are reflected within 1 reactive tick.

---

### Step 6.2 — Quick Actions on Hover (REQ-CARD-2)

**Current state:** `KanbanCard.vue` has click-to-chat (`openChat()` at line 72, bound via `@click="openChat"` on `.kanban-card` div at line 162) and a context menu via `<CardContextMenu>` wrapper. There is no hover overlay. The store exposes `sessionsStore.interruptSession(cardId)` for soft interrupt and `sessionsStore.stopSession(cardId)` for hard kill. `sessionsStore.isActive(cardId)` checks if a query is running.

**What to do:**

1. **Add a hover overlay** inside `.kanban-card` — A semi-transparent overlay that appears on `:hover` containing action buttons. Use CSS `opacity: 0` → `opacity: 1` transition (150ms) on `.kanban-card:hover .card-actions`.

2. **Action buttons:**
   - **Stop** (`i-lucide-square` icon) — Only visible when card is active. Uses `v-if="sessionsStore.isActive(card.id)"`. Calls `sessionsStore.interruptSession(card.id)` on click. Must use `@click.stop` to prevent triggering `openChat`.
   - **Edit** (`i-lucide-pencil` icon) — Always visible. Calls `handleEdit()`. Must use `@click.stop`.

3. **Z-index management:** The overlay sits above card content but below the context menu. Use `z-index: 1` on `.card-actions`, rely on the context menu's own stacking context.

4. **Drag compatibility:** The overlay buttons must NOT prevent the card from being draggable. The KanbanColumn handles drag via the parent — as long as `@click.stop` is on the buttons (not `@mousedown.stop`), drag will work since drag is typically initiated by mousedown+move on the card surface.

**Files to modify:**
- `app/components/KanbanCard.vue` — Add `.card-actions` overlay div with two `UButton` components (Stop, Edit). Add CSS for hover reveal. Import/access `sessionsStore.isActive()` and `sessionsStore.interruptSession()`.

**Acceptance:**
- Hovering a card reveals Stop and Edit buttons in the top-right corner.
- Stop is only visible when card state is `active` (query running).
- Clicking Stop calls `interruptSession()` and the card returns to idle.
- Clicking Edit opens the EditCardDialog.
- Clicking the card surface (not on buttons) still opens chat.
- Dragging the card still works.

---

### Step 6.3 — Linked Files File Picker (REQ-CARD-3)

**Current state:** `EditCardDialog.vue` uses two plain `UInput` fields per linked file entry (label + path, lines 77-88). No autocomplete, no browse button. The Tauri `open` dialog is already available (`@tauri-apps/plugin-dialog` v2.6.0 installed, `dialog:allow-open` permitted in capabilities).

**What to do:**

1. **Create `FilePickerInput.vue`** — A new component that combines:
   - A `UInput` text field for typing the file path manually (with autocomplete).
   - A browse button (`UButton`, icon `i-lucide-folder-open`) that opens the Tauri `open()` dialog.

   Props:
   ```ts
   defineProps<{
     modelValue: string;          // v-model for the path
     projectPath: string;         // base path for relative resolution + dialog starting dir
     placeholder?: string;
   }>();
   ```

   **Autocomplete mechanism:** On input, use `invoke('list_project_files', { projectPath, prefix })` — but this command doesn't exist yet. Simpler approach: use a debounced Tauri `readDir` scan (via `@tauri-apps/plugin-fs`) of the project directory, filtered by the typed prefix. Cache the file list on component mount (scan the top 2 levels). Render suggestions in a `UPopover` or simple dropdown.

   **Browse button:** Calls `open({ defaultPath: projectPath, multiple: false, directory: false })`. Converts the absolute result path to a relative path (strip `projectPath + '/'` prefix) before emitting.

2. **Integrate in `EditCardDialog.vue`** — Replace the path `UInput` (line 83-87) with `<FilePickerInput>`. The dialog needs to receive `projectPath` as a new prop from `KanbanCard.vue`.

3. **Pass `projectPath` from `KanbanCard.vue`** — Add `project-path` prop to `EditCardDialog`. Compute from `projectsStore.activeProject.path` (or worktree path if applicable, same logic as `onFileClick` at lines 139-144).

**Files to create:**
- `app/components/FilePickerInput.vue` — New component: text input + browse button + autocomplete dropdown.

**Files to modify:**
- `app/components/EditCardDialog.vue` — Replace path `UInput` with `FilePickerInput`. Accept new `projectPath` prop.
- `app/components/KanbanCard.vue` — Pass `project-path` to `EditCardDialog` (compute from project/worktree path).

**Acceptance:**
- Typing in the path field shows autocomplete suggestions from the project directory.
- Clicking the browse button opens a native file picker scoped to the project.
- Selected files are stored as relative paths.
- Manual path entry still works (type anything, no validation blocking).

---

### Step 6.4 — Linked Files Git Status Colors (REQ-CARD-4)

**Current state:** Linked file tags in `KanbanCard.vue` use `UButton variant="link" color="neutral"` (line 189-197) with `var(--text-muted)` color via `.file-tag` CSS. No git status information. The Rust backend has `git_branch_status` in `commands.rs` as a pattern for git commands.

**What to do — Backend (Rust):**

1. **Add `git_file_status` command to `commands.rs`:**

   ```rust
   #[tauri::command]
   pub async fn git_file_status(
       repo_path: String,
       file_paths: Vec<String>,
   ) -> serde_json::Value
   ```

   Implementation: Run `git -C <repo_path> status --porcelain -- <file1> <file2> ...` in a blocking thread. Parse the porcelain output (first two chars = XY status). For each requested file:
   - If the file appears in git output with status `M`, `A`, `??`, etc. → `"modified"`
   - If the file doesn't appear in git output → check if it exists on disk (`fs::metadata`). If yes → `"clean"`. If no → `"missing"`.

   Return: `{ "<filepath>": "clean"|"modified"|"missing" }`.

2. **Register in `lib.rs`** — Add `commands::git_file_status` to the `generate_handler![]` macro.

**What to do — Frontend service:**

3. **Create `app/services/git-status.ts`:**

   ```ts
   export type FileGitStatus = 'clean' | 'modified' | 'missing';

   export async function getFilesGitStatus(
     repoPath: string,
     filePaths: string[]
   ): Promise<Record<string, FileGitStatus>>
   ```

   Calls `invoke('git_file_status', { repoPath, filePaths })`. Returns the map.

**What to do — UI integration:**

4. **Update `KanbanCard.vue`** — Add a reactive `fileStatuses` ref (`Record<string, FileGitStatus>`). Create a `refreshFileStatuses()` function that calls `getFilesGitStatus()` with the project/worktree path and all linked file paths.

   Trigger refresh on:
   - `onMounted` (initial load).
   - `watch(() => props.card.state)` — when state transitions to `'idle'` (agent finished, same pattern as `refreshBranchStatus` at line 48-50).
   - `watch(() => props.card.linkedFiles)` — when files change.

   Apply status colors to `.file-tag` elements:
   - `clean` → `var(--text-muted)` (default, unchanged).
   - `modified` → `var(--warning)` (amber).
   - `missing` → `var(--error)` (red).

   Use a computed style or dynamic class: `:class="fileStatusClass(label)"` where `fileStatusClass` returns `'file-tag--modified'` or `'file-tag--missing'` based on `fileStatuses[filePath]`.

**Files to create:**
- `app/services/git-status.ts` — Frontend service wrapping the Tauri command.

**Files to modify:**
- `src-tauri/src/commands.rs` — Add `git_file_status` command.
- `src-tauri/src/lib.rs` — Register `commands::git_file_status` in `generate_handler![]`.
- `app/components/KanbanCard.vue` — Import git-status service, add reactive state, apply color classes to file tags.

**Acceptance:**
- File tags show neutral color for clean files, amber for modified, red for missing.
- Colors refresh when the agent finishes working (state → idle).
- Colors refresh when linked files are edited.
- No visual change for cards with no linked files.

---

### Step 6.5 — GitHub Issues External Browser & Edit/ContextMenu Verification (REQ-CARD-5, REQ-CARD-6)

**Current state analysis:**

- **`openIssue()`** (KanbanCard.vue line 74-78): Already uses `import('@tauri-apps/plugin-opener').then(m => m.openUrl(...))`. This is correct — `@tauri-apps/plugin-opener` opens URLs in the system default browser. **Status: Already working.** Verify at implementation time with a real GitHub issue link.

- **`EditCardDialog.vue`**: Already fully Nuxt UI — uses `UModal`, `UFormField`, `UInput`, `UTextarea`, `UButton`. No native HTML form elements remain. **Status: Complete.**

- **`CardContextMenu.vue`**: Already fully Nuxt UI — uses `UContextMenu` with `items` array. **Status: Complete.**

**What to do:**

1. **Manual verification** — Open the app, test clicking a GitHub issue on a card, confirm it opens in the default browser.
2. **Audit `EditCardDialog.vue`** after Step 6.3 changes — Ensure the FilePickerInput integration didn't introduce any non-Nuxt-UI elements.
3. **Audit `CardContextMenu.vue`** — Confirm no regressions from Phase 1 migration.

This step is primarily verification. If issues are found, fix them. If everything passes, document it in the commit message.

**Files to modify:**
- None expected (verification only). Fix any issues found during audit.

**Acceptance:**
- Clicking a linked GitHub issue opens it in the user's default external browser.
- EditCardDialog uses 100% Nuxt UI components.
- CardContextMenu uses 100% Nuxt UI components.
- No native `confirm()`, `alert()`, or raw HTML `<input>`/`<select>` elements remain.

---

## Phase 7 — Telemetry

**Goal:** Implement both local metrics and the remote telemetry system. Wire the telemetry opt-in (created as UI-only in Phase 4) to the real service.

**Covers:** REQ-TEL-L1 through REQ-TEL-L3, REQ-TEL-R1 through REQ-TEL-R5

**Depends on:** Phase 4 (Home screen for metrics display, onboarding for opt-in UI), Phase 5 (Settings for telemetry section)

### Step 7.1 — Local Metrics Infrastructure

**Files to modify:**
- `app/services/database.ts` — Add aggregation queries: cost by date range, tokens by date range, session counts. Add per-project cost aggregate.
- `app/stores/sessions.ts` — Ensure metrics are persisted to DB on session result.

**Acceptance:** Database can answer: total cost today/week/month, total tokens, session count — across all projects or per-project.

### Step 7.2 — Remote Telemetry Service

**Files to create:**
- `app/services/telemetry.ts` — New service. Manages anonymous install ID (UUID), opt-in state, event queue, HTTP submission. Supports adoption events (launch, session), feature usage events, error events. Sanitizes all data before sending. Queues events when offline, sends on next launch.

**Files to modify:**
- `app/stores/settings.ts` — Add `telemetryEnabled` and `telemetryInstallId` fields.
- `app/plugins/error-handler.ts` — Dispatch error events to telemetry service when opted in.

**Acceptance:** When opted in, events are collected and queued. When opted out, nothing is collected. Install ID is anonymous UUID.

### Step 7.3 — Telemetry Settings Integration

**Files to modify:**
- `app/components/GlobalSettingsPage.vue` — Wire Telemetry section to real telemetry service. "View telemetry data" shows the queued events.
- `app/components/HomeScreen.vue` — Wire usage metrics block to real database queries from Step 7.1.

**Acceptance:** Settings toggle controls telemetry. View shows real data. Home metrics show real aggregates.

### Step 7.4 — Wire Telemetry to Onboarding & Error Handler

The onboarding wizard (built in Phase 4, Step 4.6) has a telemetry opt-in checkbox that stores the preference. This step wires it to the real telemetry service.

**Files to modify:**
- `app/components/OnboardingWizard.vue` — Wire the telemetry checkbox to `telemetry.ts` service (initialize install ID on first opt-in).
- `app/plugins/error-handler.ts` — Dispatch error events to `telemetry.ts` when opted in.
- `app/app.vue` — Initialize telemetry service on mount if opted in.

**Acceptance:** Telemetry opt-in during onboarding activates the real telemetry service. Errors are dispatched to telemetry when opted in.

---

## Phase 8 — Distribution & Release

**Goal:** Set up CI/CD, version check, and download page so the app can be built, released, and discovered by users.

**Covers:** REQ-DIST-1 through REQ-DIST-4, REQ-TEST-3

**Depends on:** All previous phases (the CI pipeline runs tests established in Phase 1, and the app must be feature-complete before distributing).

**Execution order:** Step 8.1 first (CI/CD is the foundation — release.yml depends on build.yml). Step 8.2 and 8.3 are independent of each other and can be done in any order after 8.1. Each step gets its own commit.

---

### Step 8.1 — CI/CD Pipeline (REQ-DIST-1, REQ-DIST-2, REQ-TEST-3)

**Current state:** No `.github/workflows/` directory exists. `src-tauri/Cargo.toml` has scaffold defaults (`description = "A Tauri App"`, `authors = ["you"]`). `tauri.conf.json` is already customized (identifier `ai.oncraft.app`, productName `OnCraft`) but has no platform-specific bundle config (macOS category, Windows WiX, Linux deb/AppImage metadata).

**What to do:**

1. **Create `.github/workflows/build.yml`** — CI workflow triggered on push to `main` and on PRs:

   **Jobs:**
   - `test` — Install pnpm, install deps, run `pnpm test`. Runs on `ubuntu-latest`. Fast feedback gate.
   - `build` — Matrix build for 3 platforms × architectures. Depends on `test` passing.

   **Build matrix:**
   | Runner | Target | Sidecar triple | Output |
   |--------|--------|----------------|--------|
   | `macos-latest` (ARM) | `aarch64-apple-darwin` | `aarch64-apple-darwin` | `.dmg` |
   | `macos-13` (Intel) | `x86_64-apple-darwin` | `x86_64-apple-darwin` | `.dmg` |
   | `ubuntu-22.04` | `x86_64-unknown-linux-gnu` | `x86_64-unknown-linux-gnu` | `.AppImage`, `.deb` |
   | `windows-latest` | `x86_64-pc-windows-msvc` | `x86_64-pc-windows-msvc` | `.msi`, `.nsis` |

   **Per-build steps:**
   1. Checkout repo.
   2. Install system deps (Linux: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, etc. via `apt-get`).
   3. Install Rust toolchain (`dtolnay/rust-toolchain@stable`).
   4. Install Bun (`oven-sh/setup-bun@v2`) — needed for sidecar compilation.
   5. Install pnpm (`pnpm/action-setup@v4`) + Node (`actions/setup-node@v4` with `cache: pnpm`).
   6. `pnpm install`.
   7. Build sidecar: `cd src-sidecar && bun install && bun build --compile --target=bun agent-bridge.ts --outfile ../src-tauri/binaries/agent-bridge-$TRIPLE`. The triple must match the Tauri target.
   8. `pnpm tauri build --target $TARGET` (or let Tauri auto-detect on native runners).
   9. Upload artifacts via `actions/upload-artifact@v4` — the built binaries from `src-tauri/target/release/bundle/`.

   **Key considerations:**
   - The sidecar build uses `bun build --compile` which produces a platform-native binary. Each matrix entry builds the sidecar for its own platform.
   - `beforeBuildCommand` in `tauri.conf.json` runs `pnpm build:sidecar && pnpm build`. In CI, we should build the sidecar manually first (to control the target triple), then run `pnpm build` (Nuxt generate), then `pnpm tauri build`. Override `beforeBuildCommand` via env or run Tauri CLI directly with `--no-bundle` then bundle separately. **Simplest approach:** set env `TAURI_CLI_NO_DEV_SERVER_WAIT=true` and let the existing `beforeBuildCommand` handle it, but replace the `build:sidecar` script with a CI-aware version that uses the correct triple.
   - Artifacts should be named with version and platform for easy identification.

2. **Create `.github/workflows/release.yml`** — Release workflow triggered on tag push (`v*`):

   **Steps:**
   1. Trigger condition: `on: push: tags: ['v*']`.
   2. Call the build workflow as a reusable workflow (`uses: ./.github/workflows/build.yml`) or duplicate the build steps (reusable is cleaner).
   3. Download all build artifacts from the build job.
   4. Extract version from tag (`${GITHUB_REF#refs/tags/v}`).
   5. Generate changelog: extract commits since last tag (`git log --oneline $PREV_TAG..HEAD`). Simple approach — no conventional-changelog tooling needed for v1.
   6. Create GitHub Release via `softprops/action-gh-release@v2`:
      - Tag name from the push event.
      - Body = generated changelog.
      - Upload all binary artifacts (`.dmg`, `.msi`, `.AppImage`, `.deb`, `.nsis`).
      - Mark as pre-release if tag contains `-alpha`, `-beta`, `-rc`.

   **Alternative (simpler):** Use `tauri-apps/tauri-action@v0` which handles building + releasing in one step. This is the officially recommended approach. It handles:
   - Cross-platform builds via matrix.
   - Automatic artifact upload to GitHub Releases.
   - Tag-based release creation.

   **Decision:** Use `tauri-apps/tauri-action` for the build+release flow. This simplifies both workflows significantly. `build.yml` uses it for CI artifact uploads, `release.yml` uses it with `tagName` and `releaseName` for release creation.

3. **Clean up `src-tauri/Cargo.toml`:**
   - `description` → `"Kanban board for managing Claude Code sessions"`
   - `authors` → `["Albert Puig-Sech"]`
   - Remove the `# See more keys...` comment.

4. **Clean up `src-tauri/tauri.conf.json`:**
   - Add `bundle.macOS.minimumSystemVersion`: `"10.15"` (Catalina — required for WebKit2).
   - Add `bundle.category`: `"DeveloperTool"`.
   - Add `bundle.shortDescription`: `"Kanban board for managing Claude Code sessions"`.
   - Add `bundle.longDescription` with a brief product description.
   - Verify `bundle.targets: "all"` produces the right formats per platform (it does — Tauri auto-selects dmg/app on macOS, msi/nsis on Windows, deb/appimage on Linux).

**Files to create:**
- `.github/workflows/build.yml`
- `.github/workflows/release.yml`

**Files to modify:**
- `src-tauri/tauri.conf.json` — Add bundle metadata (category, descriptions, macOS minimum version).
- `src-tauri/Cargo.toml` — Fix description and authors.

**Acceptance:**
- Push to `main` triggers `build.yml`: tests run, Tauri builds for all 4 platform targets, artifacts are uploaded.
- Pushing a `v*` tag triggers `release.yml`: builds run, GitHub Release is created with changelog body and all binary artifacts attached.
- `Cargo.toml` and `tauri.conf.json` have real metadata (no scaffold defaults).

---

### Step 8.2 — Version Check on Startup (REQ-DIST-3)

**Current state:** No version check exists. The app version is `0.1.0` in `package.json`, `tauri.conf.json`, and `Cargo.toml`. The repo is `apuigsech/oncraft` on GitHub. `app.vue` `onMounted` loads stores, installs presets, and shows onboarding — but does no version checking.

**What to do:**

1. **Create `app/services/version-check.ts`:**

   Exports:
   ```ts
   interface UpdateInfo {
     currentVersion: string
     latestVersion: string
     changelog: string
     downloadUrl: string
     htmlUrl: string  // GitHub Release page URL
   }

   async function checkForUpdate(): Promise<UpdateInfo | null>
   ```

   **Implementation:**
   - Read local version from `__APP_VERSION__` (injected by Vite via `define` in `nuxt.config.ts`, sourced from `package.json`). Alternatively, hardcode or import from a generated module. **Simplest approach:** use a Vite define (`import.meta.env.APP_VERSION`) configured in `nuxt.config.ts` to read `package.json` version at build time.
   - Fetch `https://api.github.com/repos/apuigsech/oncraft/releases/latest` (no auth needed for public repos).
   - Parse `tag_name` (strip leading `v`), compare with local version using basic semver string comparison (split on `.`, compare numeric parts). No need for a semver library for simple `X.Y.Z` comparison.
   - If remote is newer, return `{ currentVersion, latestVersion, changelog: body, downloadUrl, htmlUrl }`.
   - `downloadUrl` = the `html_url` of the release (points to the GitHub Releases page where users can pick their platform). Platform-specific asset URLs can be derived from `assets[]` array if needed, but the release page is simpler.
   - If remote is not newer or fetch fails, return `null`. Failures must be silent (no error UI — the user can't act on a failed version check).
   - Add a 5-second timeout on the fetch to avoid blocking startup.
   - Cache the check result for the session (don't re-check on every tab switch).

   **Version injection in `nuxt.config.ts`:**
   ```ts
   vite: {
     define: {
       __APP_VERSION__: JSON.stringify(require('./package.json').version)
     }
   }
   ```
   Or use `import` syntax since the project is ESM.

2. **Create `app/components/UpdateNotice.vue`:**

   A non-intrusive banner at the top of the app (inside `#app`, above `TabBar`). Design:
   - Horizontal bar with accent background, subtle.
   - Text: "OnCraft vX.Y.Z is available" + truncated changelog (first 2 lines or 120 chars).
   - "View release" button (opens `htmlUrl` in external browser via `@tauri-apps/plugin-opener`).
   - "Dismiss" X button (hides for this session, does NOT persist — will show again on next launch).
   - Uses Nuxt UI components (`UButton`, `UIcon`).
   - Animates in with a slide-down transition.

   **Props:** `updateInfo: UpdateInfo`
   **Emits:** `dismiss`

3. **Modify `app/app.vue`:**

   - Add reactive state: `updateInfo = ref<UpdateInfo | null>(null)`.
   - After `appReady.value = true`, fire version check in background (don't await — must not delay app readiness):
     ```ts
     checkForUpdate().then(info => { updateInfo.value = info })
     ```
   - Render `<UpdateNotice>` above `<TabBar>` when `updateInfo` is non-null:
     ```vue
     <UpdateNotice v-if="updateInfo" :update-info="updateInfo" @dismiss="updateInfo = null" />
     ```

**Files to create:**
- `app/services/version-check.ts`
- `app/components/UpdateNotice.vue`

**Files to modify:**
- `app/app.vue` — Add version check on mount, render `UpdateNotice`.
- `nuxt.config.ts` — Add `__APP_VERSION__` define (if not already present).

**Acceptance:**
- On startup, the app silently checks GitHub Releases for a newer version.
- If a newer version exists, a non-intrusive banner appears with the version number, changelog summary, and a link to the release page.
- The banner can be dismissed (disappears for the session).
- If the check fails (network error, rate limit, etc.), nothing happens — no error UI.
- If the app is already on the latest version, no banner appears.

---

### Step 8.3 — Download Page (REQ-DIST-4)

**Current state:** No `docs/download/` directory exists. The spec requires a static download page that can be hosted anywhere.

**What to do:**

1. **Create `docs/download/index.html`:**

   Self-contained static HTML page (no build tooling, no framework). Includes:

   **Content:**
   - Header: "[ProductName]" title + tagline ("Kanban board for managing Claude Code sessions").
   - System requirements: macOS 10.15+, Windows 10+, Linux (Ubuntu 22.04+ or equivalent with WebKit2GTK).
   - Prerequisites: Claude CLI, Anthropic API key.
   - Download section: 3 platform cards (macOS, Windows, Linux), each with:
     - Platform icon/name.
     - Architecture variants (macOS: Apple Silicon + Intel, Windows: x64, Linux: x64).
     - Download button linking to the latest GitHub Release asset. Use the pattern `https://github.com/apuigsech/oncraft/releases/latest/download/{asset-name}` for direct download, or link to the releases page `https://github.com/apuigsech/oncraft/releases/latest` as a fallback.
   - "View all releases" link → `https://github.com/apuigsech/oncraft/releases`.
   - Installation instructions per platform (brief: macOS = open .dmg, drag to Applications; Windows = run .msi; Linux = `chmod +x` AppImage or install .deb).
   - Footer: License (FSL → Apache 2.0), GitHub repo link.

   **Styling:**
   - Inline CSS (self-contained, no external deps).
   - Dark theme to match the app's Tokyo Night aesthetic.
   - Responsive (works on mobile browsers).
   - Minimal and clean — not a marketing page, just a functional download hub.

   **Placeholder:** Asset filenames use a pattern like `OnCraft_0.1.0_aarch64.dmg`. These will match what `tauri-apps/tauri-action` produces. The exact filenames will be confirmed after the first CI build runs, but Tauri follows a predictable naming pattern: `{productName}_{version}_{arch}.{ext}`.

**Files to create:**
- `docs/download/index.html`

**Acceptance:**
- Opening the HTML file in a browser shows a clean download page with platform-specific download links.
- Links point to GitHub Releases (either latest or specific release pattern).
- The page works standalone (no server, no JS framework, no external CSS dependencies).
- The page is responsive and readable on mobile.

---

## Summary: Phase → Requirements Mapping

| Phase | Requirements Covered |
|-------|---------------------|
| 1. Foundations | REQ-UI-1, REQ-UI-2, REQ-UI-3, REQ-UI-4, REQ-UI-5, REQ-UI-6, REQ-ERR-1–4, REQ-TEST-1–2, REQ-LIC-1, REQ-README-1 |
| 2. Chat Fixes | REQ-CHAT-1–9 |
| 3. Navigation | REQ-NAV-1–7 |
| 4. Home Screen + Onboarding | REQ-HOME-1–2, REQ-ONB-1–4 |
| 5. Settings | REQ-SET-1–3, REQ-PSET-1–3 |
| 6. Card Improvements | REQ-CARD-1–6 |
| 7. Telemetry | REQ-TEL-L1–3, REQ-TEL-R1–5 |
| 8. Distribution | REQ-DIST-1–4, REQ-TEST-3 |

## Estimated Effort per Phase

| Phase | Steps | Relative Size |
|-------|-------|---------------|
| 1. Foundations | 7 | Large (widest scope, touches most files) |
| 2. Chat Fixes | 8 | Medium-Large (many individual fixes) |
| 3. Navigation | 4 | Medium (tab bar rework + state management) |
| 4. Home Screen + Onboarding | 6 | Medium-Large (new screen, queries, onboarding wizard) |
| 5. Settings | 5 | Medium (new screen layout) |
| 6. Card Improvements | 5 | Medium (new components, Tauri command) |
| 7. Telemetry | 4 | Medium (new service, wiring to existing UI) |
| 8. Distribution | 3 | Small-Medium (CI/CD config, small components) |

## Recommended Execution Order

1. **Phase 1** — Do first, unlocks everything else
2. **Phase 2 + Phase 3** — Can run in parallel (independent concerns)
3. **Phase 6** — Can start after Phase 1+2 complete
4. **Phase 4** — Needs Phase 3 (Home tab routing). Includes onboarding so the full new-user flow can be tested early.
5. **Phase 5** — Needs Phase 3 (Settings tab routing)
6. **Phase 7** — Needs Phase 4+5 (display surfaces for metrics and settings, onboarding telemetry wiring)
7. **Phase 8** — Last, needs everything stable
