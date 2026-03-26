# Product Ready — Specification

**Card:** Product Ready
**Date:** 2026-03-26
**Status:** Draft

---

## 1. Problem Statement

[ProductName] (working name: OnCraft) is a Tauri v2 desktop application that provides a Kanban board interface for managing Claude Code sessions. It was built as a personal tool and has been shared informally with a small group of users. The application now needs to evolve from a personal tool into a publicly distributable product.

The current state has critical gaps that prevent public release:

- **No first-run experience** — new users see an empty screen with no guidance, no prerequisite validation, and no explanation of what the app does.
- **No Home screen** — closing all project tabs leaves a blank void. There is no central place to manage projects or see global state.
- **Fragmented and minimal settings** — Global Settings has one toggle. Project Settings shows info but doesn't allow editing. There is no unified configuration surface.
- **Chat reliability issues** — the agent activity indicator is unreliable, input state desyncs with sidecar state, thinking blocks don't render via Nuxt UI components, tool approval widget has visual inconsistencies post-decision, and sub-agent execution has no feedback.
- **No telemetry** — neither local metrics for the user nor remote analytics for the developer.
- **No distribution pipeline** — no CI/CD, no builds, no update mechanism, no download page.
- **No error handling** — production errors are silently swallowed. No error boundaries, no crash reporting, no user-visible error feedback.
- **Visual inconsistencies** — mix of native HTML elements and Nuxt UI components, inconsistent modal/dialog styling, native `confirm()` dialogs, no loading states, no transitions.
- **No license, no README** — cannot legally distribute the software.
- **No tests** — zero test coverage across the entire codebase.

## 2. Requirements

### 2.1 Onboarding (First-Run Experience)

**REQ-ONB-1:** On first launch, the app MUST display a 3-step onboarding wizard:
- **Step 1 — Welcome:** Brief description of what [ProductName] does. Telemetry opt-in checkbox (default: off). "Continue" button.
- **Step 2 — Prerequisite Check:** Auto-detect and display status of: Claude CLI (installed + version), API key (configured), gh CLI (installed + authenticated). Each item shows green check or amber warning. Warnings are non-blocking with "How to fix" expandable hints. "Continue" button.
- **Step 3 — Open First Project:** "Open project folder" button. Brief explanation: "A project is a code repository. [ProductName] will create a .oncraft/ folder for configuration."

**REQ-ONB-2:** The onboarding MUST have a "Don't show this again" option that permanently dismisses it.

**REQ-ONB-3:** After onboarding completes (or is dismissed), the user lands on the Home screen.

**REQ-ONB-4:** Onboarding state MUST be persisted in global settings.

### 2.2 Navigation — Tab Bar with Pinned Tabs

**REQ-NAV-1:** The tab bar MUST have two pinned tabs that cannot be closed:
- **Home tab** — icon-only (house icon), always first position.
- **Settings tab** — icon-only (gear icon), always second position.

**REQ-NAV-2:** Project tabs open to the right of the pinned tabs. They function as today: click to switch, X to close, name visible.

**REQ-NAV-3:** The "+" button to add a project MUST remain in the tab bar.

**REQ-NAV-4:** Home tab is the active tab when no project tabs are open.

**REQ-NAV-5 (Draggable Tabs):** Project tabs MUST be reorderable via drag and drop. Pinned tabs (Home, Settings) MUST NOT be draggable and MUST always remain in their fixed positions. The reordered tab order MUST be persisted across app restarts.

**REQ-NAV-6 (Tab Activity Indicator):** Project tabs MUST show an activity indicator reflecting the state of sessions within that project:
- If any card in the project has state `active`, the tab MUST show a visible active indicator (e.g. colored dot, pulsing animation).
- If all cards are idle/completed, the tab MUST show a neutral/grey state or no indicator.
- This indicator MUST be in sync with the actual sidecar state (same source of truth as the card's StatusIndicator).

**REQ-NAV-7 (Per-Project Active Chat):** The active chat card MUST be tracked per project, not globally. Specifically:
- Each project tab MUST remember which card's chat was last opened.
- Switching between project tabs MUST restore the chat panel to show the card that was active in that project (or no chat if none was opened).
- This state MUST be in-memory only (not persisted). When the app restarts, no chat is open in any project until the user clicks a card.
- The current global `activeChatCardId` in `sessionsStore` MUST be replaced with a per-project map.

### 2.3 Kanban Card Component

**REQ-CARD-1 (Status Indicator):** The card's status indicator MUST be more prominent than the current dot. It MUST be clearly visible and reliably synchronized with the actual agent state. The indicator MUST reflect the real sidecar state, not just the stored `card.state` value (which may be stale).

**REQ-CARD-2 (Quick Actions on Hover):** When hovering over a card, quick action buttons MUST appear:
- **Stop/Interrupt** — visible only when the card's agent is active. Stops the running session.
- **Edit** — opens the Edit Card dialog.
These actions MUST NOT interfere with the existing click-to-chat and drag-to-move behaviors.

**REQ-CARD-3 (Linked Files — File Picker):** The Edit Card dialog MUST provide a file picker for adding linked files instead of requiring manual path entry. The picker SHOULD:
- Allow browsing files relative to the project root (or worktree root if applicable).
- Support autocomplete as the user types a path.
- Still allow manual path entry as a fallback.

**REQ-CARD-4 (Linked Files — Status Indicator):** Linked file tags displayed on the card MUST show the file's git status via color coding:
- File exists and is committed (clean) — default/neutral color.
- File exists but has uncommitted changes — modified indicator (e.g. amber).
- File does not exist — warning indicator (e.g. red).
This status SHOULD refresh when the card becomes visible or when the agent finishes working.

**REQ-CARD-5 (GitHub Issues — External Browser):** Clicking a linked GitHub issue on the card MUST open the issue in the user's default external browser. Verify this works correctly via Tauri's opener plugin.

**REQ-CARD-6 (Edit Dialog — Nuxt UI Migration):** The Edit Card dialog and Context Menu MUST be fully migrated to Nuxt UI components (covered by REQ-UI-1, but called out here for emphasis given the card's importance).

### 2.4 Home Screen

**REQ-HOME-1:** The Home screen MUST display four content blocks:

**Block 1 — Recent Projects:**
- Cards showing each known project with: name, path, number of active cards, last activity timestamp.
- Click opens the project as a tab.
- "Open new project" button.
- Projects that no longer exist on disk MUST show a warning indicator.

**Block 2 — Global Activity:**
- List of currently active cards across all projects (state = `active`).
- Each entry shows: card name, project name, current flow state, running duration.
- Clicking an entry opens that project tab and focuses the card's chat.

**Block 3 — Usage Metrics:**
- Total cost: today, this week, this month.
- Total tokens: input and output.
- Total sessions count.
- Data sourced from local database, aggregated across all projects.

**Block 4 — System Health:**
- Claude CLI: installed (yes/no), version.
- API key: configured (yes/no).
- gh CLI: installed (yes/no), authenticated (yes/no).
- Sidecar: status (running/stopped), version.
- Each item shows green/amber/red status indicator.

**REQ-HOME-2:** The Home screen MUST be accessible at any time via the pinned Home tab, even when project tabs are open.

### 2.5 Settings — Global (Full-Screen Tab)

**REQ-SET-1:** Global Settings MUST open as a full-screen view within its pinned tab, with a sidebar of sections and a main content area.

**REQ-SET-2:** Sections MUST include (at minimum):
- **General:** Theme (dark/light), chat mode (integrated/console), default model, default effort level.
- **Telemetry:** Opt-in/out toggle for remote analytics. "What do we collect?" expandable explanation.
- **System:** Prerequisite status display (same as Home health check but with more detail and action buttons like "Check again").
- **About:** App version, license info (FSL), link to changelog, link to download page.

**REQ-SET-3:** All settings MUST be persisted immediately on change (no "Save" button).

### 2.6 Settings — Project (Panel/Modal)

**REQ-PSET-1:** Project Settings MUST open as a panel or modal overlay from within the project workspace, without navigating away from the Kanban.

**REQ-PSET-2:** Project Settings MUST include (at minimum):
- Project path (read-only).
- Flow configuration: name, preset, state list. In the future this will evolve into an in-app editor, but for now the "Edit in Finder" button is acceptable as long as it uses a Nuxt UI button component.
- GitHub integration: status, auto-detected repo, manual override.

**REQ-PSET-3:** All components in Project Settings MUST use Nuxt UI components (no native HTML buttons, inputs, or checkboxes).

### 2.7 Chat — Bug Fixes and Improvements

**REQ-CHAT-1 (Tool Approval):** Verify that tool approval (Allow/Deny) works correctly with the current SDK version (0.2.84). If the `updatedInput` bug persists, fix it. Document the verification result.

**REQ-CHAT-2 (Tool Widget Consistency):** The tool block displayed after a tool approval decision (allow or deny) MUST have the same visual style as all other tool call blocks in the chat.

**REQ-CHAT-3 (Thinking/Reasoning):** Thinking blocks MUST render using the `UChatReasoning` component from Nuxt UI. Diagnose and fix why the current implementation falls back to plain message rendering.

**REQ-CHAT-4 (Sub-Agent Indicator):** When sub-agents are running, the chat MUST display an indicator showing the count of active sub-agents (e.g., "2 sub-agents running..."). This indicator SHOULD appear in or near the progress bar area.

**REQ-CHAT-5 (Agent Activity Indicator):** The chat MUST have a clear, persistent, unambiguous visual indicator when the agent is actively working (thinking, executing tools, running sub-agents). This indicator MUST be visible even when no new content is being streamed to the chat. The user must never be in doubt about whether the agent is alive.

**REQ-CHAT-7 (MCP Bridge Reliability):** The MCP tools exposed to Claude (`get_current_card`, `update_current_card`, `get_project`) MUST work reliably throughout the entire lifetime of a session. Specifically:
- The card lookup in `handleSessionRequest` MUST always find the card for the active session.
- Column transitions (card moving between flow states) MUST NOT cause the MCP bridge to lose track of the card.
- Store reloads (project switch, data refresh) MUST NOT break the association between a running sidecar process and its card.
- If the card cannot be found, the response MUST include a diagnostic error (not just `null`) to aid debugging.

**REQ-CHAT-6 (Input State Sync):** The chat input field's enabled/disabled state MUST be correctly synchronized with the actual sidecar state at all times. Specifically:
- Input MUST be disabled while the agent is processing.
- Input MUST be re-enabled immediately when the agent finishes or errors.
- There MUST NOT be a state where the user needs to switch cards and back to recover input functionality.

**REQ-CHAT-9 (Toolbar Interactions Must Not Submit):** Interacting with controls in the InputToolbar (model selector, effort level, permission mode) MUST NOT trigger the chat prompt's submit event. Currently, changing the effort level while text is in the input box causes the message to be sent automatically. The InputToolbar controls MUST be isolated from the form submission behavior of UChatPrompt.

**REQ-CHAT-8 (Markdown HTML Rendering):** The MarkdownContent component MUST correctly render inline code blocks that contain HTML tag names (e.g. code spans like `<button>`, `<input>`, `<div>`). Currently, the markdown renderer interprets these as raw HTML and either renders or truncates them, breaking the display of any message that references HTML elements. The `marked` library configuration MUST sanitize or escape HTML within code spans and fenced code blocks so they display as literal text.

### 2.8 Telemetry

#### 2.7.1 Local Metrics (for the user)

**REQ-TEL-L1:** The app MUST track and display local usage metrics: cost per card, cost per project, global cost aggregates (today/week/month), token counts (input/output), session counts, session durations.

**REQ-TEL-L2:** Local metrics MUST be stored in the local SQLite database and MUST NOT be transmitted anywhere.

**REQ-TEL-L3:** Local metrics MUST be visible in the Home screen (Block 3) and in per-card displays (as today, but enhanced).

#### 2.7.2 Remote Telemetry (for the developer)

**REQ-TEL-R1:** Remote telemetry MUST be opt-in (default: off). The user MUST explicitly enable it during onboarding or in Settings.

**REQ-TEL-R2:** Remote telemetry MUST be anonymous. The following MUST NEVER be collected:
- Project names, paths, or file contents.
- Card names, descriptions, or chat content.
- API keys, tokens, or credentials.
- IP addresses (strip at the collection endpoint).
- Any personally identifiable information.

**REQ-TEL-R3:** Remote telemetry MUST collect only:
- **Adoption:** Anonymous install ID (UUID generated on first opt-in), app version, OS, launch frequency, session duration.
- **Feature usage:** Chat mode used (integrated/console), worktree usage (yes/no), GitHub integration enabled (yes/no), Flow presets used (preset name only), model/effort selections.
- **Errors:** Error type, error message (sanitized — no paths or user data), stack trace (code frames only, no file paths), sidecar error codes.

**REQ-TEL-R4:** The user MUST be able to see exactly what data is being collected (a "View telemetry data" option in Settings).

**REQ-TEL-R5:** The user MUST be able to opt-out at any time in Settings, which immediately stops all remote data collection.

### 2.9 UI/UX — Visual Consistency and Polish

**REQ-UI-1 (Nuxt UI Exclusive):** ALL interactive components MUST use Nuxt UI components. No native HTML `<button>`, `<input>`, `<select>`, or `<checkbox>` elements in the application UI. This includes migrating all existing dialogs (NewSessionDialog, EditCardDialog, ProjectSettings, GlobalSettings, CardContextMenu, all inline dialogs in KanbanColumn).

**REQ-UI-2 (No Native Dialogs):** The `confirm()` browser dialog MUST be replaced with Nuxt UI modal confirmations throughout the app.

**REQ-UI-3 (Loading States):** The app MUST show appropriate loading indicators:
- App startup: a branded splash/loading screen while stores initialize.
- Project loading: skeleton loaders in the Kanban area.
- Chat history loading: skeleton or spinner in the chat panel.
- Any async operation that takes more than 200ms.

**REQ-UI-4 (Empty States):** All empty states MUST be designed (not plain text):
- Empty Kanban column: subtle illustration or icon + hint text + CTA.
- Empty chat: styled prompt with suggestion to start chatting.
- Home with no projects: welcoming illustration + "Open your first project" CTA.

**REQ-UI-5 (Transitions):** State changes MUST have smooth transitions:
- Tab switching.
- Chat panel open/close.
- Card drag and drop.
- Modal/dialog open/close.
- Card state changes (active/idle/error/completed).

**REQ-UI-6 (Custom Theme):** The app MUST have a custom Nuxt UI theme that gives [ProductName] a distinct visual identity. The Tokyo Night color scheme currently used for code highlighting MAY serve as inspiration but the theme should be cohesive across the entire app, not just code blocks.

### 2.10 Error Handling

**REQ-ERR-1 (Toast Notifications):** Recoverable errors MUST display a toast notification using Nuxt UI's toast system. Toasts MUST have a readable message (not raw error strings) and MUST auto-dismiss after a reasonable time.

**REQ-ERR-2 (Vue Error Boundary):** A Vue error boundary MUST wrap major component areas (Kanban, Chat, Settings). If a component crashes, it MUST display a fallback UI with "Something went wrong" and a retry/reload option — not a blank screen.

**REQ-ERR-3 (Global Error Handler):** The app MUST register handlers for `window.onerror` and `unhandledrejection`. These MUST:
- Log the error locally.
- Send to remote telemetry if opted in.
- NOT show intrusive UI for errors the user can't act on.

**REQ-ERR-4 (Non-Blocking):** Errors MUST NOT block the user from using the app unless truly critical (database corruption, sidecar binary missing).

### 2.11 Distribution

**REQ-DIST-1 (CI/CD):** A GitHub Actions workflow MUST produce builds for:
- macOS: `.dmg`
- Windows: `.msi`
- Linux: `.AppImage`

**REQ-DIST-2 (GitHub Releases):** Builds MUST be published as GitHub Releases with a changelog.

**REQ-DIST-3 (Version Check):** On app startup, the app MUST check for new versions by querying the GitHub Releases API. If a newer version exists:
- Show a non-intrusive notification (not blocking).
- Display the changelog of the new version.
- Provide a link to the download page.

**REQ-DIST-4 (Download Page):** A static download page MUST exist (placeholder URL until domain/name finalized) listing available builds per platform.

### 2.12 License and README

**REQ-LIC-1:** The repository MUST include a LICENSE file using the Functional Source License (FSL), converting to Apache 2.0 after 2 years.

**REQ-README-1:** The repository MUST include a README.md with:
- Product description (using `[ProductName]` placeholder).
- Screenshots.
- System requirements (OS versions, prerequisites).
- Installation instructions (download link).
- Quick start guide.
- License summary.
- Link to changelog.

### 2.13 Testing

**REQ-TEST-1:** The project MUST have a test framework configured (Vitest recommended for the frontend, Cargo test for Rust).

**REQ-TEST-2:** Tests MUST cover critical paths:
- **Sidecar protocol:** JSON message parsing, start/reply/stop lifecycle, error message handling.
- **Chat part registry:** Each registered message type maps to the correct component, placement, and verbosity.
- **Database:** Migrations are idempotent, CRUD operations for projects and cards work correctly, snake_case to camelCase conversion.
- **Flow loader:** Preset loading, preset + project override merging, state order resolution.

**REQ-TEST-3:** CI/CD pipeline MUST run tests before producing builds.

## 3. Constraints

- **Name is provisional:** All references use `[ProductName]`. The name "OnCraft" is a working title and may change.
- **Branding is out of scope:** Icon, logo, color palette, splash screen design are not part of this spec. The current icon and theme are used as placeholders.
- **No auto-updater:** The app checks for updates and notifies the user, but does not download or install updates automatically.
- **No in-app Flow editor:** Flow configuration continues to require editing YAML/markdown files externally. The project settings "Edit in Finder" button is acceptable for this release.
- **Download page:** A static page with binaries. Full marketing website is out of scope.
- **Telemetry backend:** The spec defines what data is collected and the opt-in mechanism. The backend infrastructure (collection endpoint, dashboard) is defined separately.
- **Localization:** English only for this release.
- **Platform support:** macOS (primary, ARM + Intel), Windows, Linux. macOS is the priority development and testing platform.

## 4. Out of Scope

- Rebranding (new name, new logo, new domain).
- Marketing website.
- User accounts or authentication.
- Cloud sync of settings or data.
- Auto-updater (download + install).
- In-app Flow editor (visual YAML editing).
- Full E2E test suite (Playwright/Cypress).
- Package manager distribution (Homebrew, winget, scoop).
- Code signing and notarization (tracked separately — required for macOS but is an infrastructure task).
- Multiple Flow presets (only `swe-basic` for this release).
- Light theme implementation (theme infrastructure yes, light variant deferred).

## 5. Acceptance Criteria

The release is considered ready when:

1. A new user can install the app from a downloaded binary, go through onboarding, open a project, create a card, and have a successful chat session with Claude — without encountering silent errors or confusing blank states.
2. The Home screen displays accurate project, activity, metric, and health data.
3. Global Settings tab contains all defined sections and persists changes.
4. The chat correctly indicates agent activity at all times, input state is synchronized, thinking blocks render via Nuxt UI, and tool approval works reliably.
5. Remote telemetry only activates on explicit opt-in, collects only the specified anonymous data, and can be inspected and disabled.
6. All UI components use Nuxt UI — no native HTML interactive elements remain.
7. The app has loading states, empty states, transitions, and a cohesive custom theme.
8. Errors are handled gracefully: toasts for recoverable, error boundary for component crashes, global handler for uncaught.
9. CI/CD produces builds for all three platforms and publishes to GitHub Releases.
10. Version check on startup notifies of new versions with changelog.
11. FSL license file and README (with placeholder name) are present.
12. Critical path tests pass in CI.
