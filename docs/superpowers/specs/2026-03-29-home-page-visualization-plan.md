# Home Page Visualization — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-03-29-home-page-visualization-design.md`

## Dependency Graph

```
Step 1 (types) ──┐
                  ├── Step 3 (projectsStore) ──┐
Step 2 (DB) ─────┘                             ├── Step 6 (HomeScreen rewrite)
                  ┌── Step 4 (sessionsStore) ───┤
                  │                             │
                  └── Step 5 (useProjectActions)┘
```

Steps 1-2 are foundational. Steps 3-5 can be done in parallel after 1-2. Step 6 depends on all previous steps.

---

## Step 1: Type Definitions

**Goal:** Add new types and extend existing interfaces to support the new data model.

**Files to modify:**
- `app/types/index.ts`

**Changes:**
1. Add `closed` field to `Project` interface:
   ```ts
   closed?: boolean;
   ```
2. Add `lastViewedAt` field to `Card` interface:
   ```ts
   lastViewedAt?: string;
   ```
3. Add new types for the Activity panel:
   ```ts
   export type ActivityPriority = 'attention' | 'active' | 'unseen' | 'inactive';

   export interface ActivityCardRow {
     id: string;
     projectId: string;
     projectName: string;
     name: string;
     columnName: string;
     lastActivityAt: string;
     lastViewedAt: string | null;
     state: string;
     priority: ActivityPriority;
     // Live data (from sessionsStore, not DB)
     toolName?: string;
     toolContext?: string;
   }
   ```
4. Add type for sparkline data:
   ```ts
   export interface DailyCost {
     date: string;
     cost: number;
   }
   ```

---

## Step 2: Database Migrations & Queries

**Goal:** Add new columns and queries needed by the Home dashboard.

**Files to modify:**
- `app/services/database.ts`

**Changes:**

1. **New migrations** (in `runMigrations`):
   ```sql
   ALTER TABLE projects ADD COLUMN closed INTEGER DEFAULT 0
   ALTER TABLE cards ADD COLUMN last_viewed_at TEXT
   ```

2. **Modify `getAllProjects()`**: Include the `closed` column in the SELECT and map it to `closed: boolean`.

3. **New function `setProjectClosed(id, closed)`**: Updates the `closed` column.

4. **New function `getCostByDay(days)`**: Returns daily cost aggregation for sparkline:
   ```sql
   SELECT date(last_activity_at) AS date,
          COALESCE(SUM(cost_usd), 0) AS cost
   FROM cards
   WHERE last_activity_at >= datetime('now', '-N days')
     AND session_id != '' AND session_id IS NOT NULL
   GROUP BY date(last_activity_at)
   ORDER BY date ASC
   ```

5. **Modify `getActiveCardsAllProjects()`**: Expand to return cards in all 4 priority tiers:
   - Active cards (state = 'active')
   - Recent inactive cards (state != 'active', last_activity_at within 24h, not archived)
   - Include `last_viewed_at` in the SELECT
   - Join with projects table to get `project_name`

6. **New function `updateCardLastViewedAt(cardId)`**: Sets `last_viewed_at = CURRENT_TIMESTAMP`.

7. **Modify `getCardsByProject()`**: Include `last_viewed_at` in SELECT and mapping.

**Dependencies:** Step 1 (types) for `DailyCost` and `ActivityCardRow`.

---

## Step 3: Projects Store — Closed Project Support

**Goal:** Change `closeProject` to mark as closed instead of deleting. Add `removeProject` for permanent deletion.

**Files to modify:**
- `app/stores/projects.ts`

**Changes:**

1. **Rename current `removeProject` to be the permanent delete** (keep existing logic).

2. **New `closeProject(id)` function**: Calls `db.setProjectClosed(id, true)`, updates in-memory project to `closed: true`, but does NOT remove from `projects` array.

3. **New `reopenProject(id)` function**: Calls `db.setProjectClosed(id, false)`, updates in-memory project to `closed: false`.

4. **Modify `addProject()`**: If the project already exists in DB with `closed=true`, reopen it instead of inserting.

5. **New computed `openProjects`**: Filters `projects` to `closed !== true` — used by TabBar to hide closed projects from tabs.

6. **Sorting**: `projects` ordered by: open first, then by `lastOpenedAt` descending.

**Dependencies:** Step 2 (DB functions `setProjectClosed`).

---

## Step 4: Sessions Store — lastViewedAt & Live Tool Tracking

**Goal:** Track when user last viewed a card's chat. Expose current tool/state per active session for the Activity panel.

**Files to modify:**
- `app/stores/sessions.ts`

**Changes:**

1. **Update `openChat(cardId)`**: After setting `activeChatCardByProject`, call `db.updateCardLastViewedAt(cardId)` and update the in-memory card's `lastViewedAt`.

2. **New reactive map `activeToolByCard`**: `Map<string, { toolName: string; toolContext: string }>`. Updated by the message handler when `tool_use` messages arrive. Cleared on `result` or session end.

3. **New reactive map `cardAttentionState`**: `Map<string, 'approval' | 'error' | 'rate_limit'>`. Set when `tool_confirmation`, error, or rate_limit messages arrive. Cleared when resolved (reply sent, error acknowledged).

4. **Expose both maps** in the store's return value so `HomeScreen.vue` can read them.

**Dependencies:** Step 2 (DB function `updateCardLastViewedAt`).

---

## Step 5: useProjectActions — Updated Close/Reopen Flow

**Goal:** Update the composable to use the new close/reopen semantics.

**Files to modify:**
- `app/composables/useProjectActions.ts`

**Changes:**

1. **Modify `closeProject(projectId)`**: Call `projectsStore.closeProject(projectId)` (mark as closed) instead of `projectsStore.removeProject(projectId)`. Navigate away from the closed project's tab (switch to next open project or home).

2. **Add `reopenProject(projectId)`**: Call `projectsStore.reopenProject(projectId)`, then `switchToProject(projectId)`.

3. **Keep `removeProject`** as a separate action (permanent delete) — available from Home's context menu or project settings.

**Dependencies:** Step 3 (projectsStore close/reopen functions).

---

## Step 6: HomeScreen.vue — Full Rewrite

**Goal:** Replace the current HomeScreen with the Mission Control Dashboard layout.

**Files to modify:**
- `app/components/HomeScreen.vue`

**Changes:**

This is the largest step. The component is self-contained (no sub-components to extract — all zones are simple enough to stay in one file), so this is a full rewrite of template + styles, with script changes to wire up the new data.

### Script changes:

1. **Remove** old header logic (title/subtitle).
2. **Keep** existing data loaders (`loadProjectSummaries`, `loadActiveCards`, `loadUsageMetrics`, `loadHealthChecks`) but enhance them:
   - `loadActiveCards`: use the expanded query that returns all 4 priority tiers, merge with live data from `sessionsStore.activeToolByCard` and `sessionsStore.cardAttentionState`.
   - New `loadCostByDay()`: fetch sparkline data via `getCostByDay(7)`.
3. **Add** computed `sortedActivityCards`: takes DB rows + live session data, assigns priority, sorts by priority then recency.
4. **Add** helper function `getToolBadgeColor(toolName)`: returns color pair for tool badges.
5. **Import** `reopenProject` from `useProjectActions`.

### Template changes (5 zones):

**Zone 1 — Stats Bar:**
- Full-width row above the grid
- Active count (from `activeCards.length` where priority is 'active' or 'attention')
- Cost today (from `usageMetrics.costToday`)
- Session count (from `usageMetrics.sessionCount`)
- Health dots (from `healthResult.items` — show dot per item, colored by status)

**Zone 2 — Recent Projects:**
- Iterate `projectsStore.projects` (includes closed)
- Each row: avatar (initial + color), name, path, stats
- Open projects: full opacity, green dot if has active sessions, "N active" + "N cards"
- Closed projects: opacity 0.55, no dot, "N cards" + "Nd ago"
- Click handler: `switchToProject(id)` for open, `reopenProject(id)` for closed
- Header: section title + "Open project" button

**Zone 3 — Activity:**
- Iterate `sortedActivityCards`
- Each row: border-left colored by priority, card name + project + column, tool badge + context line, duration
- Priority colors: attention=`--error`, active=`--success`, unseen=`--accent`, inactive=`--border`
- Tool badges: colored spans (Bash=blue, Edit=orange, Read=green, Approval=red, Waiting=purple)
- "new" badge for unseen changes
- Click handler: `navigateToCard(projectId, cardId)`

**Zone 4 — Usage:**
- Cost metrics (today/week/month) as large numbers
- Bar chart sparkline: 7 divs with proportional heights, today highlighted
- Bottom row: sessions, input tokens, output tokens

**Zone 5 — System Health:**
- Health check items as structured rows with `bg-tertiary` cards
- Dot + label + version/detail + alert hint

### Style changes:

- Remove `.home-header`, `.home-title`, `.home-subtitle`
- New `.stats-bar` styles
- Update `.home-grid` to keep 2x2 layout below stats bar
- New styles for project avatars, activity rows with border-left, tool badges, sparkline bars
- Keep responsive breakpoint at 700px

**Dependencies:** Steps 1-5 (all previous steps must be complete).

---

## Step 7: TabBar — Filter Closed Projects

**Goal:** Ensure TabBar only shows open projects in its tab list.

**Files to modify:**
- `app/components/TabBar.vue`

**Changes:**

1. Update `draggableProjects` sync: filter to `projectsStore.openProjects` instead of `projectsStore.projects`.

This is a small change but important — without it, closed projects would still appear as tabs.

**Dependencies:** Step 3 (`openProjects` computed).

---

## Step 8: Verify & Polish

**Goal:** Test the full flow and fix edge cases.

**Checks:**
1. Open app → Home dashboard shows all 5 zones with correct data
2. Close a project → disappears from TabBar, appears dimmed in Recent Projects
3. Click closed project in Home → reopens it, switches to its tab
4. Active sessions show tool badge with correct color and context
5. Card needing approval → appears at top of Activity with red border
6. View a card's chat → "new" badge clears on next Home visit
7. Usage sparkline shows bars for last 7 days
8. Responsive: below 700px grid collapses to single column
9. Empty states: no projects, no activity, no usage data — all show appropriate messages

**Files:** No new changes — this is a validation step.

**Dependencies:** All previous steps.

---

## Summary

| Step | Description | Files | Depends on |
|------|------------|-------|-----------|
| 1 | Type definitions | `app/types/index.ts` | — |
| 2 | DB migrations & queries | `app/services/database.ts` | Step 1 |
| 3 | Projects store (close/reopen) | `app/stores/projects.ts` | Steps 1, 2 |
| 4 | Sessions store (lastViewedAt, live tools) | `app/stores/sessions.ts` | Steps 1, 2 |
| 5 | useProjectActions (close/reopen flow) | `app/composables/useProjectActions.ts` | Step 3 |
| 6 | HomeScreen.vue rewrite | `app/components/HomeScreen.vue` | Steps 1-5 |
| 7 | TabBar filter closed projects | `app/components/TabBar.vue` | Step 3 |
| 8 | Verify & polish | — | Steps 1-7 |
