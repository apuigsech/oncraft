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

### Step 6.1 — Enhanced Status Indicator

**Files to modify:**
- `app/components/StatusIndicator.vue` — Redesign to be more prominent. Larger indicator, distinct visual per state (active: animated, idle: subtle, error: red, completed: green check).
- `app/components/KanbanCard.vue` — Ensure StatusIndicator uses real sidecar state from Phase 2 improvements.

**Acceptance:** Status indicator is clearly visible and reliably reflects the real agent state.

### Step 6.2 — Quick Actions on Hover

**Files to modify:**
- `app/components/KanbanCard.vue` — Add hover overlay with quick action buttons (Stop, Edit). Stop only visible when card is active. Buttons must not interfere with click-to-chat or drag behaviors (use `@click.stop`, careful z-index management).

**Acceptance:** Hovering a card shows action buttons. Stop interrupts the agent. Edit opens the dialog. Click-to-chat and drag still work.

### Step 6.3 — Linked Files File Picker

**Files to modify:**
- `app/components/EditCardDialog.vue` — Replace manual path input with a file picker component. Use Tauri's `open` dialog scoped to the project directory. Add autocomplete input as alternative.
- `app/components/FilePickerInput.vue` — New component. Combines a text input with autocomplete and a browse button that opens the native file dialog.

**Acceptance:** Users can browse for files or type with autocomplete. Manual entry still works as fallback.

### Step 6.4 — Linked Files Git Status Colors

**Files to create/modify:**
- `app/services/git-status.ts` — New service. Given a project path and file path, returns git status (clean, modified, untracked, missing). Uses Tauri command or sidecar.
- `src-tauri/src/commands.rs` — Add `git_file_status` command that runs `git status --porcelain` for specific files.
- `app/components/KanbanCard.vue` — Color linked file tags based on git status. Refresh on card visibility change and on agent finish.

**Acceptance:** File tags show green (clean), amber (modified), red (missing). Status refreshes automatically.

### Step 6.5 — GitHub Issues External Browser & Edit Dialog Migration

**Files to modify:**
- `app/components/KanbanCard.vue` — Verify `openIssue()` opens in external browser via `@tauri-apps/plugin-opener`. Fix if needed.
- `app/components/EditCardDialog.vue` — Complete Nuxt UI migration (from Step 1.3, verify completeness).
- `app/components/CardContextMenu.vue` — Complete Nuxt UI migration (from Step 1.3, verify completeness).

**Acceptance:** Issue links open in external browser. Edit dialog and context menu are fully Nuxt UI.

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

**Goal:** Set up CI/CD, version check, and download page.

**Covers:** REQ-DIST-1 through REQ-DIST-4, REQ-TEST-3

**Depends on:** All previous phases

### Step 8.1 — CI/CD Pipeline

**Files to create:**
- `.github/workflows/build.yml` — GitHub Actions workflow. Runs tests (`pnpm test`). Builds sidecar. Builds Tauri for macOS (ARM + Intel), Windows, Linux. Uploads artifacts.
- `.github/workflows/release.yml` — Triggered on tag push. Runs build workflow. Creates GitHub Release with changelog and binaries.

**Files to modify:**
- `src-tauri/tauri.conf.json` — Clean up scaffold defaults (description, authors). Verify bundle config for all platforms.
- `src-tauri/Cargo.toml` — Clean up scaffold defaults.

**Acceptance:** Push to main runs tests + builds. Tag push creates a GitHub Release with .dmg, .msi, .AppImage.

### Step 8.2 — Version Check on Startup

**Files to create/modify:**
- `app/services/version-check.ts` — New service. Fetches latest release from GitHub Releases API. Compares with local version. Returns changelog and download URL if newer version exists.
- `app/app.vue` — On mount (after stores load), run version check. Show notification banner if update available.
- `app/components/UpdateNotice.vue` — New component. Non-intrusive banner with changelog preview and download link.

**Acceptance:** On startup, if a newer version exists on GitHub, a non-blocking banner shows with changelog and download link.

### Step 8.3 — Download Page

**Files to create:**
- `docs/download/index.html` — Static HTML page listing available builds per platform with download links pointing to GitHub Releases. Placeholder branding.

**Acceptance:** A static page exists that can be hosted anywhere, listing platform-specific downloads.

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
