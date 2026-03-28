# Overall Workspace Visualisation — Implementation Plan

**Spec**: `docs/superpowers/specs/2026-03-28-overall-workspace-visualisation-spec.md`

## Overview

Three independent UI refinement tasks (R1, R2, R3), each modifying a single component. No shared dependencies between them — they can be implemented in any order. The plan sequences them from least to most risk: column headers (isolated), chat header (isolated), tab bar (touches `app.vue` routing).

## Step 1 — Column Header Redesign (R2)

**Files to modify**: `app/components/KanbanColumn.vue`

**Changes**:

1.1. **Replace the `column-title` div** (lines 157-168) with the icon-box layout:
   - Wrap the `UIcon` (or color-dot fallback) inside a new `column-icon-box` div: `width:28px; height:28px; border-radius:6px; display:flex; align-items:center; justify-content:center`. Background uses the state color at 12% opacity via inline `style` binding: `` :style="{ background: flowState.color + '1F' }" `` (hex `1F` ≈ 12%).
   - For the no-icon fallback: render the existing `color-dot` inside the icon box instead of standalone.
   - Stack name + count vertically in a `column-title-text` wrapper:
     - Name: `<span>{{ flowState.name }}</span>` — keep 13px/600 styling.
     - Count: `<span class="column-card-count">{{ dragCards.length }} {{ dragCards.length === 1 ? 'card' : 'cards' }}</span>` — 10px, `color: var(--text-muted)`.
   - Move warning icon after the stacked text (same tooltip behavior).

1.2. **Replace the `header-actions` div** (lines 169-172) with a `UDropdownMenu`:
   - Trigger: `UButton` with `icon="i-lucide-ellipsis"`, variant ghost, size xs.
   - Menu items:
     - `{ label: 'New session', icon: 'i-lucide-plus', click: () => showNewDialog = true }`
     - `{ label: 'Import sessions', icon: 'i-lucide-download', click: () => showImportDialog = true }`

1.3. **Update `<style scoped>`**:
   - Add `.column-icon-box` styles.
   - Add `.column-title-text` flex column styles.
   - Add `.column-card-count` styles.
   - Remove old `.card-count` badge styles if any.
   - Adjust `.column-header` padding to accommodate the slightly taller layout (~40px → ~46px).

**Dependencies**: None. Fully self-contained.

## Step 2 — Chat Panel Header Redesign (R3)

**Files to modify**: `app/components/ChatPanel.vue`

**Changes**:

2.1. **Resolve column color**: Add a computed that derives the column color from `flowStore`:
   ```ts
   const columnColor = computed(() => {
     if (!card.value?.columnName) return 'var(--accent)';
     const state = flowStore.getFlowState(card.value.columnName);
     return state?.color || 'var(--accent)';
   });
   ```

2.2. **Restructure the `chat-header` template** (lines 179-206):
   - Replace the flat layout with:
     ```
     .chat-header
       .chat-header-accent  (3px vertical bar, background: columnColor)
       .chat-header-info    (flex column)
         .chat-header-title (14px/600, session name)
         .chat-header-meta  (10px mono, muted: "columnName · $cost · ↑in ↓out")
       .chat-header-right   (flex row, gap 8px)
         ContextGauge
         close button
     ```
   - Remove `SessionMetrics` component from the header — its data (cost, tokens) is now inlined in `.chat-header-meta`.
   - The meta line format: `{{ card.columnName }} · ${{ metrics.costUsd.toFixed(3) }} · ↑{{ formatTokens(metrics.inputTokens) }} ↓{{ formatTokens(metrics.outputTokens) }}`
   - Add a `formatTokens` helper (same as KanbanCard's: `< 1000 → raw, else → Xk`).

2.3. **Metric flash effect**:
   - Add a `metricFlash` ref (`ref(false)`).
   - Watch `metrics.costUsd` and `metrics.inputTokens`: when either changes and is > 0, set `metricFlash = true`, then `setTimeout(() => metricFlash = false, 100)`.
   - Bind `:class="{ 'metric-flash': metricFlash }"` on `.chat-header-meta`.
   - CSS: `.chat-header-meta { transition: color 0.6s ease; color: var(--text-muted); }` and `.chat-header-meta.metric-flash { color: var(--accent); transition: color 0.05s ease; }`. The fast transition-in (0.05s) + slow transition-out (0.6s) creates a "flash and fade" effect.

2.4. **Update `<style scoped>`**:
   - Replace `.chat-header` styles: `display:flex; align-items:center; gap:10px; padding:8px 14px;`
   - Add `.chat-header-accent`: `width:3px; border-radius:2px; align-self:stretch; flex-shrink:0;`
   - Add `.chat-header-info`: `flex:1; min-width:0; display:flex; flex-direction:column; gap:1px;`
   - Add `.chat-header-title`: `font-size:14px; font-weight:600; color:var(--text-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;`
   - Add `.chat-header-meta`: `font-size:10px; font-family:'SF Mono','Fira Code',monospace; color:var(--text-muted); transition: color 0.6s ease;`
   - Add `.metric-flash`: `color: var(--accent); transition: color 0.05s ease;`
   - Remove old `.chat-title` and `.header-metrics` styles.

**Dependencies**: None. Independent of Step 1.

## Step 3 — Tab Bar Restructuring (R1)

**Files to modify**: `app/components/TabBar.vue`, `app/app.vue`

**Changes**:

3.1. **TabBar.vue — Add new emits and restructure template**:
   - Add emit: `'open-global-settings'` (new).
   - Keep emit: `'open-project-settings'` (existing).
   - Replace the template structure:

     **Left zone** — Logo/Home icon:
     ```html
     <div class="tab-logo" @click="projectsStore.activeTab = 'home'" title="Home">
       <UIcon name="i-lucide-hexagon" class="logo-icon" />
     </div>
     ```
     Separated from tabs by a subtle right border.

     **Center zone** — Project tabs (existing `VueDraggable` block), but modify each tab:
     - Active tab gets a dropdown chevron + `UDropdownMenu`:
       ```html
       <UDropdownMenu v-if="projectsStore.activeTab === project.id" :items="tabMenuItems(project)">
         <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-chevron-down" class="tab-chevron" square />
       </UDropdownMenu>
       ```
     - `tabMenuItems(project)` returns:
       ```ts
       [[
         { label: 'Project Settings', icon: 'i-lucide-sliders-horizontal', click: () => emit('open-project-settings') },
       ], [
         { label: 'Close Project', icon: 'i-lucide-x', color: 'error' as const, click: () => closeProject(project.id) },
       ]]
       ```

     **Right zone** — Gear icon:
     ```html
     <UButton variant="ghost" color="neutral" size="xs" icon="i-lucide-settings"
       class="action-btn" square title="Settings"
       @click="projectsStore.activeTab = 'settings'" />
     ```

   - Remove: the two pinned Home/Settings tab divs.
   - Remove: the project-settings sliders `UButton` (and its `v-if`).

3.2. **TabBar.vue — Update styles**:
   - Add `.tab-logo`: `display:flex; align-items:center; padding:6px 10px; color:var(--accent); border-right:1px solid var(--border); margin-right:6px; cursor:pointer; -webkit-app-region:no-drag;`
   - Add `.logo-icon`: `font-size:18px;`
   - Add `.tab-chevron`: styles for the small dropdown arrow on active tab.
   - Remove `.tab--pinned` styles (no longer used).

3.3. **app.vue — Update settings routing**:
   - The `GlobalSettingsPage` render condition (`activeTab === 'settings'`) remains unchanged — it's already triggered by setting `activeTab` to `'settings'`.
   - The `ProjectSettings` modal is already wired via `@open-project-settings` — no change needed.
   - No changes to `app.vue` template or logic required. The TabBar now internally sets `activeTab = 'settings'` for global settings (same as before) and emits `'open-project-settings'` for project settings (same as before).

**Dependencies**: None functionally, but scheduled last because it touches navigation routing and needs careful testing of the Home/Settings/Project tab switching flow.

## Step 4 — Smoke Test & Visual QA

**Files**: None (manual verification).

4.1. Verify all tab switching works: logo → home, gear → settings, project tabs → board.
4.2. Verify project tab dropdown: Project Settings opens modal, Close Project removes tab.
4.3. Verify project tab drag-to-reorder still works.
4.4. Verify macOS window drag region works (drag by empty tab bar area).
4.5. Verify column headers: icon box renders, card count updates, "..." menu opens with New/Import.
4.6. Verify chat header: accent bar color matches column, name + meta stacked, metric flash triggers on token change.
4.7. Verify no console errors or warnings.

**Dependencies**: Steps 1, 2, 3 all complete.

## Summary

| Step | Component | Requirement | Risk | Estimated Scope |
|------|-----------|-------------|------|-----------------|
| 1 | KanbanColumn.vue | R2 | Low | ~40 lines template + ~20 lines CSS |
| 2 | ChatPanel.vue | R3 | Low | ~30 lines template + ~25 lines CSS + ~15 lines script |
| 3 | TabBar.vue + app.vue | R1 | Medium | ~50 lines template + ~25 lines CSS + ~15 lines script |
| 4 | — | All | — | Manual QA |
