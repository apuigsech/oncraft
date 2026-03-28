# Card Visualisation Redesign

## Problem

The KanbanCard component has evolved organically. The current design has two main issues:

1. **Poor visual hierarchy** — all elements (name, description, files, branch, issues, tags, cost, time-ago) compete for attention at similar font sizes and weights. Nothing stands out as primary.
2. **Layout problems** — elements are poorly organized spatially: the hover overlay for actions covers content, the footer crams branch/issues/tags/time into one line, and linked files are styled as flat text tags that don't visually communicate their interactive nature.

## Design: Zoned Rows

The card is restructured into **4 horizontal zones**, each separated by a subtle border (`1px solid var(--bg-tertiary)`). Each zone has one clear purpose, creating a top-to-bottom reading flow.

### Zone 1 — Identity Bar

```
[LED]  Card Name                          [⋯]
```

- **Status LED** (10px circle, left-aligned): The primary visual indicator of session state.
  - `active`: Filled `var(--success)` with gentle pulsing glow animation (2s infinite)
  - `idle`: Transparent with `1.5px` border in `var(--text-muted)`
  - `error`: Filled `var(--error)` with red glow
  - `completed`: Green SVG checkmark (replaces circle)
- **Card name**: 13px, font-weight 600, `var(--text-highlighted)`. Single line with ellipsis overflow.
- **Actions button** (`⋯`): Right-aligned, `var(--text-muted)`. Opens a dropdown menu with all actions (Edit, Fork, Archive, Delete, Stop if active). Replaces the current hover overlay that covers card content.

**Removed from header**: WT badge, Fork badge, time-ago. The WT/Fork info is available via the `⋯` menu or the Edit dialog. Time-ago is removed entirely (the status LED provides sufficient activity indication).

### Zone 2 — Description

```
  Short description text with ellipsis...
```

- 11px, `var(--text-muted)`. Single line, ellipsis overflow.
- Padding: `6px 12px`.
- If no description, this zone is hidden (no empty space).

### Zone 3 — Linked Files (Interactive)

```
  [spec]  [plan]  [tasks ●]  [tests]
```

- Chips displayed in a flex-wrap row with 4px gap.
- Each chip: `padding: 2px 8px`, `border-radius: 4px`, `font-size: 11px`, cursor pointer.
- **Status colors** determine both background tint and text/border color:
  - **Normal** (file exists, unmodified): `rgba(--accent, 0.12)` background, `var(--accent)` text, `rgba(--accent, 0.2)` border
  - **Modified**: `rgba(--warning, 0.12)` background, `var(--warning)` text/border. Small `●` indicator after label.
  - **Missing**: `rgba(--error, 0.12)` background, `var(--error)` text/border. Label has strikethrough.
  - **Active** (currently open in file viewer): Slightly stronger opacity (`0.2` bg, `0.4` border) to indicate selection.
- Clicking a chip opens the file in the FileViewer (existing behavior, preserved).
- If no linked files, this zone is hidden.

### Zone 4 — Meta Line

```
  feat/auth ↑2 · #42 #45               $0.12 · 48k
```

- Single line, `font-size: 10px`, `var(--text-muted)`.
- **Left side** (flex, gap 6px):
  - Branch name in `var(--text-secondary)`
  - Ahead count in `#4ade80` (green), behind count in `#f87171` (red), checkmark `✓` if synced — only shown if branch exists
  - Separator `·` in `var(--bg-tertiary)` between branch and issues
  - Issue numbers in `var(--accent)`, clickable (opens in browser via `@tauri-apps/plugin-opener`)
- **Right side** (pushed right via `justify-content: space-between`):
  - Cost in USD (4 decimal places if < $1, 2 if >= $1)
  - Separator `·`
  - Token count (formatted as `Xk`)
  - Only shown if `costUsd > 0`
- If no branch, no issues, and no cost — this zone is hidden.

### Card Container

- Background: `var(--bg-secondary)` (`#24283b`)
- Border: `1px solid var(--bg-tertiary)` (`#2f3549`)
- Border-radius: `8px`
- **Error state override**: Border becomes `1px solid rgba(--error, 0.3)` to subtly highlight the card
- Hover: Background shifts to `var(--bg-tertiary)` (existing behavior)
- Click: Opens the chat panel for this card (existing behavior)
- **No left color border** — the status LED and zone structure provide sufficient visual hierarchy

### Removed Elements

| Element | Reason |
|---------|--------|
| Left color border (column color) | Replaced by LED + zone structure for hierarchy |
| WT badge | Low-frequency info, accessible via Edit dialog |
| Fork badge | Low-frequency info, accessible via Edit dialog |
| Tags (UBadge pills) | Rarely used in practice, adds visual noise |
| Time-ago | Redundant with status LED; active sessions don't need a timestamp |
| Hover action overlay | Replaced by `⋯` dropdown menu |
| Cost footer (separate section) | Merged into Zone 4 meta line |

### Zone Visibility Rules

Zones 2, 3, and 4 are conditionally rendered:

| Zone | Visible when |
|------|-------------|
| Zone 1 (Identity) | Always |
| Zone 2 (Description) | `card.description` is non-empty |
| Zone 3 (Files) | `card.linkedFiles` has at least one entry |
| Zone 4 (Meta) | Card has branch, linked issues, or cost > 0 |

A minimal card (no description, no files, no branch/issues/cost) shows only Zone 1 — just the LED, name, and menu button.

### Actions Menu (⋯ Dropdown)

The dropdown uses Nuxt UI's `UDropdownMenu` component (already available in the project). It replaces both the hover overlay and the right-click context menu content. Items:

1. **Stop** (only if `state === 'active'`) — calls `sessionsStore.interruptSession`
2. **Edit** — opens `EditCardDialog`
3. **Fork** — emits fork event to column
4. **Archive** / **Unarchive** — toggles `card.archived`
5. **Delete** — shows confirmation modal, then removes card

The right-click `CardContextMenu` wrapper is preserved for convenience (same actions).

## Files to Modify

| File | Changes |
|------|---------|
| `app/components/KanbanCard.vue` | Complete template + style rewrite. Remove hover overlay, add `⋯` dropdown. Restructure into 4 zones. |
| `app/components/StatusIndicator.vue` | Minor: ensure sizes work at 10px for the new layout |
| `app/components/KanbanColumn.vue` | No changes expected (passes `flowState.color` as `columnColor` — this prop can be kept for potential future use or removed) |

## Future Evolution (Not In Scope)

- **Adaptive sizing (option C)**: Active cards expanded with full detail, idle/completed cards collapsed to Zone 1 + Zone 3 only. The zone architecture makes this a CSS-only change.
- **Card progress indicator**: A thin progress bar in Zone 1 showing flow state completion (e.g., 3/6 states done).
- **Drag handle**: Dedicated drag grip area instead of full-card drag.
