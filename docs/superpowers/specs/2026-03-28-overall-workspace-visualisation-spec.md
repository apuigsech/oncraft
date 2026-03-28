# Overall Workspace Visualisation — Specification

## Problem Statement

OnCraft's main workspace UI has grown organically across multiple iterations. While the Kanban cards were recently polished to a high standard, the surrounding workspace elements — the tab bar, column headers, and chat panel header — lack visual cohesion. Specifically:

1. **Tab bar mixes concerns**: Home, Settings, and Project tabs all share the same row as equal-level tabs, blurring the hierarchy between navigation (projects) and utility actions (home, settings). The project-settings button appears as a separate icon that competes with the global-settings gear.

2. **Column headers are basic**: The current header is a flat row with an icon/color-dot, name, a `UBadge` for card count, and action buttons. It doesn't match the polished quality of the cards below it, and the badge-style count feels visually noisy.

3. **Chat panel header lacks hierarchy**: The header is a single horizontal row containing the session name (bold), a column badge, metrics (ContextGauge + SessionMetrics), and a close button, all at the same visual weight. There's no visual grouping or emphasis to distinguish the session identity from the operational metrics.

4. **No visual feedback on metrics**: Token counts and cost in the chat header update silently. Users have no visual cue when values change, making it easy to miss cost spikes or context growth during a session.

These issues are cosmetic, not functional — the app works correctly. But as a developer tool meant for daily use, visual polish and consistency directly impact perceived quality and cognitive load.

## Requirements

### R1 — Tab Bar Restructuring

Restructure the tab bar to separate navigation (projects) from utility actions (home, settings).

**R1.1** — Replace the Home and Settings pinned tabs with a dedicated logo/home icon on the far left, visually separated from the project tabs by a subtle border.

**R1.2** — Clicking the logo/home icon navigates to the Home screen (same behavior as current Home tab).

**R1.3** — Move global settings to a gear icon on the far right of the tab bar.

**R1.4** — The tab row between logo and gear is exclusively for project tabs (draggable, with activity dot, close button).

**R1.5** — Add a dropdown arrow (chevron) on the active project tab that opens a context menu with: "Project Settings" (opens the existing ProjectSettings modal), and "Close Project" (same as current close button, with destructive styling).

**R1.6** — Remove the separate project-settings sliders icon from the right side. Project settings are now accessed via the tab dropdown (R1.5).

**R1.7** — Preserve the macOS drag region (`-webkit-app-region: drag`) behavior — all interactive elements must be `no-drag`.

**R1.8** — Preserve existing tab drag-to-reorder functionality for project tabs.

#### Acceptance Criteria

- [ ] Home and Settings are no longer tabs in the tab row
- [ ] Logo icon on the far left opens the Home screen
- [ ] Gear icon on the far right opens global settings
- [ ] Active project tab shows a dropdown chevron
- [ ] Dropdown contains Project Settings and Close Project
- [ ] Project tabs remain draggable to reorder
- [ ] Window drag region works correctly on macOS

### R2 — Column Header Redesign

Replace the flat column header with a structured icon-box layout.

**R2.1** — Display the Flow state icon inside a rounded container (6px radius) with a subtle tinted background matching the state color at ~12% opacity.

**R2.2** — Stack the state name and card count vertically: name as 13px/600 weight on the first line, count as "N cards" in 10px muted text below.

**R2.3** — Move the Import and New Session action buttons behind a "..." (ellipsis/more) menu on the right side of the header.

**R2.4** — Preserve warning icon tooltip for Flow state configuration warnings.

**R2.5** — Fall back to a color dot inside the icon box when no icon is configured for the state.

#### Acceptance Criteria

- [ ] Icon box with tinted background renders for each column
- [ ] Name and card count are stacked vertically
- [ ] Action buttons are behind a "..." dropdown menu
- [ ] Warning tooltips still work
- [ ] States without icons show a color dot fallback

### R3 — Chat Panel Header Redesign

Improve the chat header's visual hierarchy and add metric change feedback.

**R3.1** — Add a vertical color accent bar (3px wide, matching the card's column color) on the left side of the header content area.

**R3.2** — Stack the session name (14px/600 weight) and metadata line vertically. The metadata line shows: column name, cost, token counts — in 10px mono text at muted color.

**R3.3** — Keep the ContextGauge (progress bar + percentage) on the right side, before the close button.

**R3.4** — Add a subtle visual transition effect when token counts or cost values change: apply a CSS class that sets `color` to `var(--accent)` and remove it after a short delay, with `transition: color 0.6s ease` on the element so it fades back to muted. Triggered via a Vue watcher on the metric values.

**R3.5** — The close button remains on the far right.

#### Acceptance Criteria

- [ ] Vertical accent bar renders in the column's color
- [ ] Session name and meta are stacked, with clear size/weight hierarchy
- [ ] Metrics text briefly flashes accent color on value change
- [ ] Flash animation is subtle (not distracting) and uses CSS transitions
- [ ] ContextGauge and close button remain on the right
- [ ] Header height does not increase significantly (same or +4px max vs current)

## Constraints

- **Nuxt UI v4 components only** — use `UButton`, `UIcon`, `UBadge`, `UDropdownMenu`, `UTooltip` where applicable. No external component libraries.
- **Existing CSS custom properties** — use `--bg-*`, `--text-*`, `--border`, `--accent` tokens from `theme.css`. No hardcoded colors outside of computed opacity variants.
- **Tokyo Night palette** — all new colors must be derived from the existing palette defined in `assets/theme.css`.
- **Performance** — metric flash animations must use CSS transitions (no JavaScript animation loops). No `requestAnimationFrame` for visual effects.
- **No functional changes** — all existing behaviors (drag-and-drop, session management, sidecar communication, DB persistence) must remain unchanged.
- **Component boundaries** — modifications scoped to `TabBar.vue`, `KanbanColumn.vue`, `ChatPanel.vue`, and their `<style scoped>` blocks. New components only if a dropdown menu requires one.

## Out of Scope

- **Kanban card redesign** — cards were recently polished and are explicitly excluded.
- **Chat message rendering** — only the header is in scope, not the message area, input box, or toolbar.
- **Console panel** — the terminal-based ConsolePanel is not part of this work.
- **Home screen redesign** — the HomeScreen content/layout is unchanged; only its access point (logo icon) changes.
- **Settings pages redesign** — GlobalSettingsPage and ProjectSettings content are unchanged; only their entry points change.
- **Light theme** — current work targets dark mode only (the only theme in use).
- **New features** — no new functionality, only visual refinement of existing elements.
- **Mobile/responsive** — OnCraft is a desktop Tauri app; no mobile considerations.
