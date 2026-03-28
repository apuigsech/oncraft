# Settings Visualization — Specification

## Problem Statement

OnCraft's settings experience is fragmented and visually unpolished compared to the rest of the app:

1. **Global settings page looks basic**: The current `GlobalSettingsPage.vue` uses a sidebar-sections layout that feels flat. Controls are functional but lack the visual refinement of the Kanban cards and chat panel. Sections are organized under a single "General" umbrella that conflates appearance settings with session defaults.

2. **Project settings modal is cramped**: The `ProjectSettings.vue` modal is capped at 500px width. It shows the flow as a plain list of states and a basic GitHub section. The "Edit Flow Config" button just opens the OS file manager — there's no way to select or preview flow presets in-app.

3. **No persistent project context**: When working on a project, there's no visible indicator of the project path, connected GitHub repo, or active flow preset without opening the project settings modal. This information is useful context that should be glanceable.

4. **Code duplication and dead state**: Option definitions (model, effort, permission mode) are duplicated across `GlobalSettingsPage.vue`, `InputToolbar.vue`, and other components instead of being shared constants. The `defaultColumns` field in `GlobalSettings` is legacy dead code that's still persisted to YAML. The effort bar widget CSS is copy-pasted between two components.

These issues are cosmetic and structural — the settings work correctly. But for a tool used daily, visual polish and information architecture directly impact perceived quality.

## Requirements

### R1 — Global Settings: Stacked Scroll Layout

Replace the current sidebar-sections layout with a single-column stacked-scroll design. All sections visible as the user scrolls, with settings grouped into rounded cards (similar to macOS System Settings).

**R1.1** — The settings page fills the main content area (replacing the board) when the gear icon is clicked, same as today.

**R1.2** — Content is centered with a `max-width` of ~520px, scrollable vertically.

**R1.3** — Page has a title ("Settings") and subtitle ("Global preferences and defaults") at the top.

**R1.4** — Remove the sidebar navigation entirely. Sections are stacked vertically with heading + subtitle above each grouped card.

#### Acceptance Criteria

- [ ] Settings page uses a single scrollable column, no sidebar
- [ ] Content is centered and constrained to ~520px width
- [ ] All four sections (R2–R5) are visible by scrolling without clicking section navigation

---

### R2 — Appearance Section

Dedicated section for visual preferences, separated from session defaults.

**R2.1** — Section heading: "Appearance", subtitle: "Visual preferences".

**R2.2** — Contains a single row: Theme toggle (Dark / Light) as pill-style segmented control on the right side of the row.

**R2.3** — Light theme option remains visually present but can show a "coming soon" hint if not yet implemented.

#### Acceptance Criteria

- [ ] Theme is in its own "Appearance" section, not bundled with other settings
- [ ] Toggle control matches the grouped-card row style

---

### R3 — Session Defaults Section

Settings that new cards inherit. Currently scattered across "General" in the old layout.

**R3.1** — Section heading: "Session Defaults", subtitle: "Default values for new cards".

**R3.2** — **Chat Mode** row: Two option cards side by side (Integrated / Console), each with a title and short description. The selected option has an accent border.

**R3.3** — **Model** row: Label + description on the left, dropdown selector on the right. Options: Haiku, Sonnet, Opus.

**R3.4** — **Effort** row: Label + description on the left, effort bar visualization on the right (the existing bar-chart widget). Clickable to cycle through levels: low, medium, high, max.

**R3.5** — **Permission Mode** row: Label + description on the left, dropdown selector on the right. Options: Default, Accept Edits, Plan, Bypass Permissions.

**R3.6** — All rows are contained in a single grouped card with divider lines between rows.

#### Acceptance Criteria

- [ ] Chat mode uses selectable option cards, not a dropdown
- [ ] Model and permission mode use dropdown selectors
- [ ] Effort uses the bar visualization widget
- [ ] All four settings are in one grouped card with row dividers

---

### R4 — Telemetry Section

Privacy settings, carried over from the existing implementation with improved presentation.

**R4.1** — Section heading: "Telemetry", subtitle: "Usage data and privacy".

**R4.2** — **Anonymous telemetry** row: Label + description on the left, toggle switch on the right.

**R4.3** — **"What do we collect?"** collapsible row below the toggle. Clicking expands to show the telemetry details.

**R4.4** — When telemetry is enabled, the install ID and "View Telemetry Data" action are accessible within the expanded details.

#### Acceptance Criteria

- [ ] Toggle switch for telemetry opt-in/out
- [ ] Collapsible detail section for telemetry info
- [ ] Contained in a single grouped card

---

### R5 — System Section (merged with About)

Health checks, version info, and diagnostics in a single section. Replaces the separate "System" and "About" sections.

**R5.1** — Section heading: "System", subtitle: "Health, version, and diagnostics".

**R5.2** — **Dependencies** subsection: List of health checks (Claude CLI, git, gh CLI) each with a status dot (green/red) and version number on the right.

**R5.3** — **App info** rows below dependencies: OnCraft version and License, each as a label + value row.

**R5.4** — Remove the disabled "Changelog" and "Download" buttons from the old About section.

#### Acceptance Criteria

- [ ] Health checks show status dot + version number (not just installed/not-installed)
- [ ] About info (version, license) is merged into System as simple rows
- [ ] No disabled placeholder buttons

---

### R6 — Project Info Bar

A thin, persistent horizontal bar between the tab bar and the Kanban columns showing project context.

**R6.1** — Visible whenever a project tab is active (not on Home or Settings screens).

**R6.2** — Single line, minimal height (~28px). Background matches the tab bar surface color with a bottom border separator.

**R6.3** — Shows three items separated by thin vertical dividers:
  - Project path (with folder icon), e.g. `~/Projects/my-app`
  - GitHub repo (with branch icon), e.g. `apuigsech/my-app` — or hidden if no repo detected
  - Flow preset name (with cycle icon), e.g. `swe-basic` — styled in accent color

**R6.4** — Path should be shortened using `~` for the home directory.

**R6.5** — The bar is read-only — no interactive controls. Clicking the preset name could optionally open Project Settings, but this is not required.

#### Acceptance Criteria

- [ ] Bar appears between tabs and columns for active projects
- [ ] Shows path, repo, and preset separated by dividers
- [ ] Does not appear on Home or Settings screens
- [ ] Height is minimal (~28px), does not compress the board significantly

---

### R7 — Project Settings Modal: Expanded and Restructured

Expand the project settings modal and reorganize its content into three clear sections.

**R7.1** — Modal width increased to ~700px (from current 500px).

**R7.2** — Modal header shows "Project Settings" title with the project name and path as subtitle.

**R7.3** — Modal body is scrollable with grouped-card sections matching the global settings visual style.

#### Acceptance Criteria

- [ ] Modal is ~700px wide
- [ ] Header identifies the project clearly
- [ ] Visual style (grouped cards, row dividers) is consistent with global settings

---

### R8 — Flow Preset Selector

In-app flow preset selection within the project settings modal, replacing the need to manually edit `flow.yaml`.

**R8.1** — **Dropdown selector**: Shows the currently active preset name and description. Clicking opens a list of available presets (scanned from `presets/` directory and any user-defined presets).

**R8.2** — **Preview panel** below the dropdown: Shows a summary of the selected preset — number of states, default agent settings (model, effort), and a mini-pipeline visualization of the states as colored badges connected by arrows.

**R8.3** — Changing the preset updates the project's `.oncraft/flow.yaml` to reference the new preset.

**R8.4** — If the project has local state overrides (files in `.oncraft/states/`), show a warning that switching presets may not remove existing overrides.

#### Acceptance Criteria

- [ ] Dropdown lists available presets
- [ ] Selected preset shows a preview with state pipeline visualization
- [ ] Changing preset updates `flow.yaml` on disk
- [ ] Warning shown when local overrides exist

---

### R9 — GitHub Configuration (improved)

Improved presentation of the existing GitHub integration settings.

**R9.1** — Show the auto-detected repository with a green status dot and "auto-detected" label.

**R9.2** — If no repo is detected, show a neutral state with "No repository detected" message.

**R9.3** — **Repository override** input below: allows the user to manually set `owner/repo`. Saves to `.oncraft/config.yaml` on blur or Enter.

**R9.4** — When an override is set, the display shows the override as the active repo with an "override" label instead of "auto-detected".

#### Acceptance Criteria

- [ ] Auto-detected repo shown with status indicator
- [ ] Override input persists to config file
- [ ] Clear visual distinction between auto-detected and overridden state

---

### R10 — Cleanup Tools

Tools to remove orphaned resources within the project settings modal.

**R10.1** — **Orphaned sessions** row: Shows a count of Claude Code sessions (from `~/.claude/projects/` matching the project path) that have no matching card `sessionId` in the database. A "Clean" button deletes them via the existing `delete_session` Tauri command after confirmation.

**R10.2** — **Orphaned worktrees** row: Shows a count of git worktrees (detected via `git worktree list` in the project directory) whose branch name matches OnCraft's naming pattern but have no matching card `worktreeName` in the database. A "Clean" button removes them via `git worktree remove` after confirmation.

**R10.3** — When no orphans are found, the row shows "None" in a neutral style with no action button.

**R10.4** — Cleanup actions should show a confirmation dialog before proceeding, listing what will be deleted.

#### Acceptance Criteria

- [ ] Orphaned sessions are detected and counted
- [ ] Orphaned worktrees are detected and counted
- [ ] Cleanup requires user confirmation
- [ ] "None" state is clearly indicated when no orphans exist

---

### R11 — Code Cleanup

Address technical debt identified during the exploration phase.

**R11.1** — Extract shared option definitions (model options, effort levels, permission modes) into a shared constants file. Remove duplication from `GlobalSettingsPage.vue`, `InputToolbar.vue`, and any other consumers.

**R11.2** — Extract the effort bar widget into a standalone reusable component (`EffortBar.vue`). Remove the duplicated CSS from `GlobalSettingsPage.vue` and `InputToolbar.vue`.

**R11.3** — Remove the `defaultColumns` field from `GlobalSettings` type and the settings store. It is legacy dead code not used by the flow system.

#### Acceptance Criteria

- [ ] Option definitions exist in one place and are imported by all consumers
- [ ] Effort bar is a single shared component
- [ ] `defaultColumns` is removed from types, store, and persisted settings

---

## Constraints

- **Nuxt UI v4** components (`UModal`, `UButton`, `USelectMenu`, `USwitch`, `UBadge`, `UIcon`) should be used where applicable. Custom styling via scoped CSS and CSS custom properties, consistent with the existing codebase approach.
- **Tokyo Night Storm** color scheme must be maintained. Use the existing CSS custom properties (`--bg-primary`, `--bg-secondary`, etc.) and Nuxt UI tokens.
- **No new dependencies** — all UI changes use existing component library and styling tools.
- **Settings persistence** — global settings continue to use YAML via `settingsStore`. Project settings continue to use filesystem (`.oncraft/`). No changes to persistence mechanisms.
- **Lazy loading** — settings page components should remain lazy-loaded via `defineAsyncComponent`.

## Out of Scope

- **Light theme implementation** — the toggle can be present but the actual light theme CSS is not part of this work.
- **In-app flow editor** — editing prompts, triggers, MCP servers, or per-state agent config remains as YAML files. Only preset selection is in-app.
- **Flow state reordering or creation** — the flow pipeline is read-only in the preview. Modifying state order or adding/removing states requires YAML editing.
- **Per-card settings UI changes** — the `InputToolbar.vue` inline settings keep their current layout. Only the shared constants extraction (R11) affects this component.
- **Onboarding wizard changes** — `OnboardingWizard.vue` is not modified.
- **Database schema changes** — no new columns or tables needed.
- **Keyboard shortcuts section** — deferred to a future iteration.
- **Advanced/power-user settings** — deferred (cache clearing, config export/import, etc.).
