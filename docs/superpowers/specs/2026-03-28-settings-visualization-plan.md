# Settings Visualization — Implementation Plan

Spec: `docs/superpowers/specs/2026-03-28-settings-visualization-spec.md`

## Phase 1 — Code Cleanup & Shared Infrastructure (R11)

Foundation work. No visual changes yet — extract shared code that the new components will use.

### Step 1.1 — Extract shared constants

Create a constants file with option definitions currently duplicated across components.

**Create:**
- `app/constants/options.ts` — export `MODEL_OPTIONS`, `EFFORT_LEVELS`, `EFFORT_LABELS`, `MODE_OPTIONS`, `CHAT_MODE_OPTIONS`

**Modify:**
- `app/components/GlobalSettingsPage.vue` — remove local option definitions (lines 28–47), import from constants
- `app/components/InputToolbar.vue` — remove local option definitions (lines 19–38), import from constants

**Dependencies:** None.

### Step 1.2 — Extract EffortBar component

Extract the duplicated effort bar widget into a reusable component.

**Create:**
- `app/components/EffortBar.vue` — props: `modelValue` (EffortLevel), emit: `update:modelValue`. Contains the bar visualization + click-to-cycle logic + all effort bar CSS.

**Modify:**
- `app/components/GlobalSettingsPage.vue` — replace inline effort bar markup and CSS with `<EffortBar v-model="effort" />`
- `app/components/InputToolbar.vue` — replace inline effort bar markup and CSS with `<EffortBar v-model="effort" />`

**Dependencies:** Step 1.1 (EffortBar imports `EFFORT_LEVELS` and `EFFORT_LABELS` from constants).

### Step 1.3 — Remove defaultColumns legacy

Remove the dead `defaultColumns` field from the settings system.

**Modify:**
- `app/types/index.ts` — remove `defaultColumns` from `GlobalSettings` interface, remove `ColumnConfig` type if unused elsewhere
- `app/stores/settings.ts` — remove `defaultColumns` from `DEFAULT_SETTINGS` object

**Dependencies:** None. Verify `ColumnConfig` is not used elsewhere before removing the type.

---

## Phase 2 — Global Settings Redesign (R1–R5)

Rewrite the global settings page with the stacked-scroll layout and new section organization.

### Step 2.1 — Rewrite GlobalSettingsPage layout

Replace the sidebar-sections layout with a single centered scrollable column. Restructure sections into: Appearance, Session Defaults, Telemetry, System.

**Modify:**
- `app/components/GlobalSettingsPage.vue` — full rewrite of `<template>` and `<style>`:
  - Remove sidebar navigation and section-switching logic
  - Single scrollable container, max-width ~520px, centered
  - Page title ("Settings") + subtitle at top
  - Four sections stacked vertically, each with heading + subtitle + grouped card

**Dependencies:** Steps 1.1, 1.2 (uses shared constants and EffortBar component).

### Step 2.2 — Appearance section (R2)

Implement the Appearance grouped card with theme toggle.

**Modify:**
- `app/components/GlobalSettingsPage.vue` — add Appearance section:
  - Single row: "Theme" label + description left, pill-style segmented control (Dark/Light) right
  - Light option present but can hint "coming soon"

**Dependencies:** Step 2.1 (needs the new layout structure).

### Step 2.3 — Session Defaults section (R3)

Implement the Session Defaults grouped card with chat mode, model, effort, and permission mode.

**Modify:**
- `app/components/GlobalSettingsPage.vue` — add Session Defaults section:
  - Chat Mode: two side-by-side option cards (Integrated/Console) with accent border on selected
  - Model: label-dropdown row using `USelectMenu` with `MODEL_OPTIONS`
  - Effort: label + `EffortBar` component row
  - Permission Mode: label-dropdown row using `USelectMenu` with `MODE_OPTIONS`
  - All rows in one grouped card with divider lines

**Dependencies:** Steps 1.1, 1.2, 2.1.

### Step 2.4 — Telemetry section (R4)

Implement the Telemetry grouped card with toggle and collapsible details.

**Modify:**
- `app/components/GlobalSettingsPage.vue` — add Telemetry section:
  - Anonymous telemetry row: label + `USwitch`
  - Collapsible "What do we collect?" row with expand/collapse
  - Install ID + "View Telemetry Data" inside collapsed details (when enabled)

**Dependencies:** Step 2.1.

### Step 2.5 — System section merged with About (R5)

Implement the System grouped card combining health checks and app info.

**Modify:**
- `app/components/GlobalSettingsPage.vue` — add System section:
  - Dependencies subsection: Claude CLI, git, gh CLI — each with status dot + version number
  - App info rows: OnCraft version, License
  - Remove disabled Changelog/Download buttons

**Dependencies:** Step 2.1.

---

## Phase 3 — Project Info Bar (R6)

New component: thin contextual bar between tabs and board.

### Step 3.1 — Create ProjectInfoBar component

**Create:**
- `app/components/ProjectInfoBar.vue` — minimal horizontal bar (~28px height):
  - Reads: `projectsStore.activeProject.path`, `flowStore.githubRepository`, `flowStore.flow?.preset`
  - Three items with vertical dividers: folder icon + path (shortened with ~), branch icon + repo, cycle icon + preset name (accent color)
  - Scoped CSS matching tab bar surface color

**Dependencies:** None (reads from existing stores).

### Step 3.2 — Insert info bar in app layout

**Modify:**
- `app/app.vue` — insert `<ProjectInfoBar>` between `<TabBar>` and `<div class="main-content">`, conditional on `isProjectTab && projectsStore.activeProject`
  - Does not show on Home (`activeTab === 'home'`) or Settings (`activeTab === 'settings'`) screens

**Dependencies:** Step 3.1.

---

## Phase 4 — Project Settings Modal Redesign (R7–R10)

Expand and restructure the project settings modal.

### Step 4.1 — Expand modal and restructure layout (R7)

Widen the modal and add proper header with project identification.

**Modify:**
- `app/components/ProjectSettings.vue` — structural changes:
  - Increase modal max-width to ~700px
  - Header: "Project Settings" title + project name/path as subtitle
  - Scrollable body with grouped-card sections (same visual style as global settings)

**Dependencies:** None.

### Step 4.2 — Flow preset selector (R8)

Add preset discovery, selection dropdown, and preview panel.

**Modify:**
- `app/services/flow-loader.ts` — add new exported function `listAvailablePresets(projectPath)`:
  - Scans `~/.oncraft/presets/` directory
  - Returns array of `{ name, description, stateCount, stateOrder, agentDefaults }` for each preset
  - Also add `loadPresetPreview(presetName)` to load a preset's full state list for preview without applying it

**Modify:**
- `app/stores/flow.ts` — add actions:
  - `listPresets()` — calls `listAvailablePresets`, returns preset summaries
  - `changePreset(presetName)` — updates `.oncraft/flow.yaml` to reference new preset, reloads flow
  - `hasLocalOverrides()` — checks if `.oncraft/states/` has any files

**Modify:**
- `app/components/ProjectSettings.vue` — add Flow Preset section:
  - Dropdown selector (`USelectMenu`) showing available presets with name + description
  - Preview panel below: state count, agent defaults, mini-pipeline visualization (colored badges with arrows)
  - Warning message when local overrides exist and preset is changed

**Dependencies:** Step 4.1.

### Step 4.3 — Improved GitHub configuration (R9)

Improve the existing GitHub section presentation.

**Modify:**
- `app/components/ProjectSettings.vue` — rewrite GitHub section:
  - Auto-detected repo: green dot + repo name + "auto-detected" label
  - No repo: neutral "No repository detected" message
  - Override input: `UInput` with placeholder, saves on blur/Enter via `flowStore.setGitHubRepository`
  - Visual distinction: "auto-detected" vs "override" label

**Dependencies:** Step 4.1.

### Step 4.4 — Cleanup tools (R10)

Add orphan detection and cleanup actions.

**Modify:**
- `src-tauri/src/commands.rs` — add two new Tauri commands:
  - `list_orphaned_sessions(project_path, card_session_ids)` — scans `~/.claude/projects/` for sessions matching the project path, returns those not in the provided ID list
  - `list_orphaned_worktrees(project_path, card_worktree_names)` — runs `git worktree list` in the project dir, returns worktrees matching OnCraft naming pattern not in the provided name list

- `src-tauri/src/lib.rs` — register the two new commands in `invoke_handler`

**Modify:**
- `app/components/ProjectSettings.vue` — add Cleanup section:
  - Orphaned sessions row: count from `list_orphaned_sessions` + "Clean" button
  - Orphaned worktrees row: count from `list_orphaned_worktrees` + "Clean" button
  - "None" state when count is 0
  - Confirmation dialog (using `@tauri-apps/plugin-dialog`) before deletion
  - Clean actions: `delete_session` (existing command) for sessions, `git worktree remove` via shell for worktrees

**Dependencies:** Steps 4.1, 4.2 (modal layout must be in place). Rust changes have no dependency on frontend steps.

---

## Phase 5 — Integration & Polish

### Step 5.1 — Verify lazy loading

**Modify (if needed):**
- `app/app.vue` — ensure `GlobalSettingsPage` and `ProjectSettings` remain lazy-loaded via `defineAsyncComponent`. Verify `ProjectInfoBar` does not need lazy loading (small component, always visible).

**Dependencies:** All previous phases.

### Step 5.2 — Visual consistency pass

Review all new and modified components for:
- Consistent use of CSS custom properties (`--bg-primary`, `--bg-secondary`, `--border`, etc.)
- Consistent Nuxt UI token usage (`.dark {}` block in theme.css)
- Consistent spacing, font sizes, border radius across global settings, project info bar, and project settings modal
- Grouped cards: same background, same border, same border-radius, same row padding/divider style everywhere

**Modify (as needed):**
- `app/components/GlobalSettingsPage.vue`
- `app/components/ProjectSettings.vue`
- `app/components/ProjectInfoBar.vue`
- `app/components/EffortBar.vue`

**Dependencies:** All previous phases.

---

## Dependency Graph

```
Phase 1 (Foundation)
  1.1 Extract constants ─────┐
  1.2 Extract EffortBar ──┐  │
  1.3 Remove defaultColumns│  │  (independent)
                           │  │
Phase 2 (Global Settings)  │  │
  2.1 Rewrite layout ←────┴──┘
  2.2 Appearance ←── 2.1
  2.3 Session Defaults ←── 2.1, 1.1, 1.2
  2.4 Telemetry ←── 2.1
  2.5 System ←── 2.1

Phase 3 (Info Bar)          (independent of Phase 2)
  3.1 Create component
  3.2 Insert in app ←── 3.1

Phase 4 (Project Settings)  (independent of Phase 2)
  4.1 Expand modal
  4.2 Preset selector ←── 4.1
  4.3 GitHub config ←── 4.1
  4.4 Cleanup tools ←── 4.1

Phase 5 (Polish)
  5.1 Lazy loading ←── all
  5.2 Visual consistency ←── all
```

**Parallelizable:** Phase 3 and Phase 4 can be done in parallel after Phase 1. Phase 2 sections (2.2–2.5) can be done in any order after 2.1.

## Files Summary

| Action | File |
|--------|------|
| Create | `app/constants/options.ts` |
| Create | `app/components/EffortBar.vue` |
| Create | `app/components/ProjectInfoBar.vue` |
| Modify | `app/components/GlobalSettingsPage.vue` (major rewrite) |
| Modify | `app/components/ProjectSettings.vue` (major rewrite) |
| Modify | `app/components/InputToolbar.vue` (minor — import shared constants/component) |
| Modify | `app/app.vue` (minor — insert ProjectInfoBar) |
| Modify | `app/types/index.ts` (minor — remove defaultColumns/ColumnConfig) |
| Modify | `app/stores/settings.ts` (minor — remove defaultColumns) |
| Modify | `app/stores/flow.ts` (moderate — add preset listing/changing actions) |
| Modify | `app/services/flow-loader.ts` (moderate — add preset discovery functions) |
| Modify | `src-tauri/src/commands.rs` (moderate — add orphan detection commands) |
| Modify | `src-tauri/src/lib.rs` (minor — register new commands) |
