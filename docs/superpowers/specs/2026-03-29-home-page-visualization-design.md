# Home Page Visualization — Design Spec

## Problem

The current Home screen (`HomeScreen.vue`) has two issues:

1. **Visual**: Flat, generic appearance that doesn't match the rest of the app's recently improved UI (KanbanCard 4-zone layout, icon-box column headers, ProjectInfoBar, redesigned settings). The centered "OnCraft / Kanban for Claude Code sessions" header and uniform 2x2 grid feel like a placeholder.

2. **Practical**: The four blocks lack utility. "Recent Projects" only shows open projects (closed ones disappear). "Activity" shows active sessions without context on what's happening. "Usage" and "System Health" are static numbers without actionable insight.

## Design Direction

**Mission Control Dashboard** — information-dense, structured layout matching the dev-tool aesthetic of the rest of the app. The Home becomes the place where you land and immediately understand: what needs my attention, what's running, where was I working, and how much am I spending.

## Layout

Five zones in a stats-bar + 2x2 grid layout:

```
┌─────────────────────────────────────────────────────┐
│  Stats Bar (full width summary strip)               │
├──────────────────────────┬──────────────────────────┤
│  Recent Projects         │  Activity (smart panel)  │
│                          │                          │
│                          │                          │
├──────────────────────────┬──────────────────────────┤
│  Usage + sparkline       │  System Health           │
│                          │                          │
└──────────────────────────┴──────────────────────────┘
```

The stats bar is Home-only (not global in the TabBar) to avoid competing with navigation.

## Zone 1: Stats Bar

A compact horizontal strip at the top summarizing global state at a glance.

**Contents:**
- Active session count with green dot (e.g., "3 active")
- Cost today (e.g., "$2.41 today")
- Total session count (e.g., "12 sessions")
- System health summary: 3 colored dots (green/amber/red) + short label (e.g., "System OK")

**Visual:** Single row, `bg-tertiary` background, subtle border, items separated by dividers. No title — the content is self-explanatory.

## Zone 2: Recent Projects

Shows all known projects (open AND closed), not just currently open ones.

### Behavior Change: Projects persist after closing

Currently, `closeProject` removes the project from `projectsStore.projects`. The new behavior:
- Closing a project marks it as closed (new `closed` boolean column in DB) but does NOT delete it
- The project disappears from the TabBar but remains in Recent Projects
- Click on a closed project reopens it (adds tab, loads cards/flow)
- Projects are ordered by last activity, open ones first
- A "Remove" action (separate from "Close") permanently deletes a project from the DB

### Visual per project card:
- Avatar: colored square with initial letter (color derived from project name)
- Project name + green activity dot (if open with active sessions)
- Path (truncated, muted)
- Stats: "N active" (green, if any) + "N cards" + relative time
- Closed projects: reduced opacity (~0.55), no activity dot, show "Nd ago" instead of active count

### Actions:
- Click: switch to project (open if closed)
- "Open project" button in section header

## Zone 3: Activity (Smart Panel)

The most important panel. Unifies active sessions, cards needing attention, unseen changes, and recent inactive cards into a single prioritized list.

### Card states (ordered by priority, top to bottom):

1. **Needs attention** (red/orange border-left)
   - Tool approval pending
   - Error state
   - Rate limit hit
   - Badge: colored tool name (e.g., red "Approval") + context line ("Bash: drop table sessions")

2. **Active** (green border-left)
   - Session is running, tool being executed
   - Badge: tool name with tool-specific color (blue "Bash", orange "Edit", etc.) + context line ("Running pnpm dev...", "Modifying src/auth.ts")

3. **Unseen changes** (blue border-left)
   - Session advanced since user last viewed the card
   - "new" badge + summary of what changed ("Completed — moved to Plan")
   - Requires tracking last-viewed timestamp per card

4. **Recent inactive** (gray border-left, reduced opacity)
   - Session completed or idle
   - "Completed 2h ago" or "Idle since 3h ago"

### Per card row:
- Card name + project name + column name
- Tool badge with color + one-line context description
- Duration/time on the right

### Data source:
- Active sessions: from `sessionsStore` streaming data (tool_use messages, state)
- Needs attention: from card state (`error`, pending tool confirmations in message stream)
- Unseen changes: requires new `lastViewedAt` field on cards, compared against `lastActivityAt`
- Recent inactive: from DB query, cards with recent activity that are no longer active

## Zone 4: Usage

Existing metrics enhanced with a weekly cost sparkline.

**Contents:**
- Top row: three large numbers — Today / Week / Month cost
- Sparkline: bar chart of cost per day for the last 7 days, today highlighted
- Bottom row: compact secondary stats — Sessions count, Input tokens, Output tokens

**Data source:** Existing `getUsageMetrics()` from `database.ts`. The sparkline requires a new query that groups cost by day for the last 7 days.

## Zone 5: System Health

Existing health checks with improved visual presentation.

**Contents:** List of health check items, each as a row with:
- Status dot (green/amber/red)
- Label (Claude CLI, Bun, Agent SDK, Sidecar)
- Version number or status text
- Alert text for amber/red items (e.g., "update available")

**Visual:** Rows in cards with `bg-tertiary` background, consistent spacing. More structured than the current inline layout.

**Data source:** Existing `runHealthChecks()` from `health-check.ts`.

## Data Model Changes

### Database changes (`database.ts`):

1. **New column `cards.last_viewed_at`** (TEXT, nullable)
   - Updated when: user clicks on a card to open its chat (i.e., `sessionsStore.activeChatCardId` changes to this card)
   - NOT updated by: viewing the card in the Home Activity panel or Kanban board
   - Used to determine "unseen changes" in Activity panel: card shows "new" badge when `lastActivityAt > lastViewedAt`

2. **New column `projects.closed`** (INTEGER, default 0)
   - Set to 1 when user closes a project (instead of deleting)
   - Projects with `closed=1` appear dimmed in Recent Projects

3. **New query `getCostByDay(days: number)`**
   - Returns array of `{ date: string, cost: number }` for sparkline
   - Groups `cost_usd` by day from cards table

4. **Modify `getActiveCardsAllProjects()`**
   - Include card's current streaming state/tool info if available
   - Add recent inactive cards (completed/idle within last 24h)

### Store changes:

1. **`projectsStore`**:
   - `closeProject()` sets `closed=1` instead of deleting
   - New `removeProject()` for permanent deletion
   - `projects` computed includes closed projects, sorted by open-first then last activity

2. **`sessionsStore`** or **`cardsStore`**:
   - Track `lastViewedAt` per card, update on chat open
   - Expose current tool/state per active session for Activity panel

## Visual Design Tokens

Follows existing theme CSS variables:

- **Backgrounds:** `--bg-primary` (app), `--bg-secondary` (panels), `--bg-tertiary` (cards/rows)
- **Borders:** `--border` for panel outlines, transparent for card rows
- **Accent colors for Activity border-left:**
  - Needs attention: `--error` (#f7768e)
  - Active: `--success` (#9ece6a)
  - Unseen: `--accent` (#7aa2f7)
  - Inactive: `--border` (#292e42)
- **Tool badge colors:**
  - Bash: blue (`#7aa2f7` bg `#7aa2f733`)
  - Edit: orange (`#e0af68` bg `#e0af6833`)
  - Read: green (`#9ece6a` bg `#9ece6a33`)
  - Approval/Waiting: red/purple as appropriate
- **Project avatars:** 26px square, rounded-6px, background from a hash of project name, white initial letter
- **Section headers:** 10px uppercase, `--accent` color, 0.5px letter-spacing
- **Closed projects:** opacity 0.55

## Responsive

- Below 700px: grid collapses to single column (existing behavior preserved)
- Stats bar wraps to two rows if needed on narrow views

## What's NOT Changing

- TabBar remains unchanged (no global stats)
- The Home header "OnCraft / Kanban for Claude Code sessions" is removed (the stats bar replaces it)
- No keyboard shortcuts in this iteration
- No search/filter functionality
- No mini-kanban per project

## Acceptance Criteria

1. Home shows stats bar with active count, cost today, session count, and health summary
2. Recent Projects lists all known projects (open and closed), closed ones dimmed
3. Closing a project removes it from TabBar but keeps it in Recent Projects
4. Clicking a closed project reopens it
5. Activity panel shows cards in priority order: needs attention > active > unseen > inactive
6. Active cards show tool badge with color and one-line context
7. Cards needing attention (approval pending, error) appear first with red/orange indicator
8. Cards with unseen changes show "new" badge
9. Usage panel shows cost sparkline for last 7 days
10. System Health shows structured rows with version info and update alerts
11. Layout is responsive (single column below 700px)
