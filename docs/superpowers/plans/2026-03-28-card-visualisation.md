# Card Visualisation Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure KanbanCard.vue from an organic, flat layout into a 4-zone horizontal band design with clear visual hierarchy.

**Architecture:** The card template is rewritten into 4 conditional zones (identity, description, files, meta) separated by borders. The hover action overlay is replaced by a `UDropdownMenu` triggered from a `⋯` button. All existing logic (branch status, file git status, file viewer integration, issue opening) is preserved — only the template and styles change.

**Tech Stack:** Vue 3, Nuxt UI v4 (`UDropdownMenu`, `UButton`), existing CSS custom properties from `theme.css`.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `app/components/KanbanCard.vue` | Rewrite template + styles | Card display with 4 zones, dropdown menu |
| `app/components/StatusIndicator.vue` | Minor tweak | Add `size: 'xs'` (10px) for the new card layout |

No new files. No store changes. `KanbanColumn.vue` and `CardContextMenu.vue` remain untouched.

---

### Task 1: Add 10px size to StatusIndicator

The spec requires the LED at 10px. The current component supports `sm` (8px) and `md` (12px). We need an intermediate size.

**Files:**
- Modify: `app/components/StatusIndicator.vue`

- [ ] **Step 1: Add `xs` to the size prop and size map**

In `app/components/StatusIndicator.vue`, update the script section:

```vue
<script setup lang="ts">
import type { CardState } from '~/types';

const props = withDefaults(defineProps<{
  state: CardState;
  size?: 'xs' | 'sm' | 'md';
}>(), { size: 'md' });

const sizeMap = { xs: 10, sm: 8, md: 12 };
const px = computed(() => sizeMap[props.size]);
</script>
```

- [ ] **Step 2: Add the `xs` CSS class**

Add after the existing `.status-indicator--sm` rule:

```css
.status-indicator--xs { width: 10px; height: 10px; }
```

- [ ] **Step 3: Verify the component still renders all 4 states**

Run the app with `pnpm tauri dev` and confirm existing cards still show their status indicators correctly. The `xs` size is not used yet — this is a non-breaking addition.

- [ ] **Step 4: Commit**

```bash
git add app/components/StatusIndicator.vue
git commit -m "feat(StatusIndicator): add xs (10px) size variant"
```

---

### Task 2: Rewrite KanbanCard template — Zone 1 (Identity Bar)

Replace the entire card template and styles. We start with Zone 1 (always visible) and the `⋯` dropdown menu, since this is the structural foundation.

**Files:**
- Modify: `app/components/KanbanCard.vue`

- [ ] **Step 1: Remove the `columnColor` prop**

The spec removes the left color border. Update the props:

```ts
const props = defineProps<{ card: Card }>();
```

- [ ] **Step 2: Remove unused code from the script section**

Delete the following from `<script setup>`:
- The `timeAgo()` function (no longer displayed)
- The `parentCardName` computed (WT/Fork badges removed)
- The `linkedFilesCount` and `linkedIssuesCount` computeds (not used in new layout)

Keep everything else — `branchStatus`, `fileStatuses`, `fileStatusClass`, `formatTokens`, `openChat`, `openIssue`, `effectiveProjectPath`, `linkedFilesEntries`, `isFileActive`, `onFileClick`, all the action handlers, refs, watchers, and imports.

- [ ] **Step 3: Add the `⋯` dropdown menu items computed**

Add this computed after the existing `githubRepo` computed:

```ts
const menuItems = computed(() => {
  const groups: any[][] = [];

  // Group 1: Stop (only if active)
  if (sessionsStore.isActive(props.card.id)) {
    groups.push([{
      label: 'Stop',
      icon: 'i-lucide-square',
      color: 'error' as const,
      onSelect: () => sessionsStore.interruptSession(props.card.id),
    }]);
  }

  // Group 2: Edit, Fork
  groups.push([
    { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => handleEdit() },
    { label: 'Fork', icon: 'i-lucide-git-branch', onSelect: () => handleFork() },
  ]);

  // Group 3: Archive/Delete
  groups.push([
    props.card.archived
      ? { label: 'Unarchive', icon: 'i-lucide-archive-restore', onSelect: () => handleUnarchive(props.card.id) }
      : { label: 'Archive', icon: 'i-lucide-archive', onSelect: () => handleArchive(props.card.id) },
    { label: 'Delete', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => handleDeleteRequest(props.card.id) },
  ]);

  return groups;
});
```

- [ ] **Step 4: Add cost formatting helper**

Add this function alongside the existing `formatTokens`:

```ts
function formatCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
}
```

- [ ] **Step 5: Add meta zone visibility computed**

```ts
const showMetaZone = computed(() => {
  return (branchStatus.value && hasExplicitBranch.value)
    || (props.card.linkedIssues?.length ?? 0) > 0
    || (props.card.costUsd ?? 0) > 0;
});
```

- [ ] **Step 6: Replace the entire template**

Replace everything inside `<template>` with:

```vue
<template>
  <CardContextMenu
    :card-id="card.id"
    :archived="card.archived"
    @edit="handleEdit"
    @fork="handleFork"
    @archive="handleArchive"
    @unarchive="handleUnarchive"
    @delete="handleDeleteRequest"
  >
    <div
      class="kanban-card"
      :class="{ 'kanban-card--error': card.state === 'error' }"
      :data-card-id="card.id"
      @click="openChat"
    >
      <!-- Zone 1: Identity Bar -->
      <div class="zone-identity">
        <StatusIndicator :state="card.state" size="xs" />
        <span class="card-name">{{ card.name }}</span>
        <UDropdownMenu :items="menuItems">
          <UButton
            variant="ghost"
            color="neutral"
            size="xs"
            icon="i-lucide-ellipsis"
            class="menu-trigger"
            @click.stop
          />
        </UDropdownMenu>
      </div>

      <!-- Zone 2: Description -->
      <div v-if="card.description" class="zone-description">
        {{ card.description }}
      </div>

      <!-- Zone 3: Linked Files -->
      <div v-if="linkedFilesEntries.length > 0" class="zone-files">
        <span
          v-for="[label, filePath] in linkedFilesEntries"
          :key="label"
          class="file-chip"
          :class="[fileChipClass(label, String(filePath))]"
          :title="String(filePath)"
          @click.stop="onFileClick($event, label, String(filePath))"
        >
          {{ label }}<span v-if="fileStatuses[String(filePath)] === 'modified'" class="file-chip-dot"> ●</span>
        </span>
      </div>

      <!-- Zone 4: Meta Line -->
      <div v-if="showMetaZone" class="zone-meta">
        <div class="meta-left">
          <template v-if="branchStatus && hasExplicitBranch">
            <span class="meta-branch">{{ branchStatus.branch }}</span>
            <span v-if="branchStatus.ahead > 0" class="meta-ahead">&uarr;{{ branchStatus.ahead }}</span>
            <span v-if="branchStatus.behind > 0" class="meta-behind">&darr;{{ branchStatus.behind }}</span>
            <span v-if="branchStatus.ahead === 0 && branchStatus.behind === 0" class="meta-synced">&check;</span>
          </template>
          <template v-if="(card.linkedIssues?.length ?? 0) > 0">
            <span v-if="branchStatus && hasExplicitBranch" class="meta-sep">&middot;</span>
            <span
              v-for="issue in card.linkedIssues"
              :key="issue.number"
              class="meta-issue"
              :title="`#${issue.number}${issue.title ? ' ' + issue.title : ''}`"
              @click.stop="openIssue(issue.number)"
            >#{{ issue.number }}</span>
          </template>
        </div>
        <div v-if="card.costUsd && card.costUsd > 0" class="meta-right">
          <span>{{ formatCost(card.costUsd) }}</span>
          <span class="meta-sep">&middot;</span>
          <span>{{ formatTokens((card.inputTokens ?? 0) + (card.outputTokens ?? 0)) }}</span>
        </div>
      </div>
    </div>
  </CardContextMenu>

  <EditCardDialog
    v-if="showEdit"
    v-model:open="showEdit"
    :name="card.name"
    :description="card.description"
    :linked-files="card.linkedFiles"
    :linked-issues="card.linkedIssues"
    :github-repo="githubRepo"
    :project-path="effectiveProjectPath"
    @save="saveEdit"
    @cancel="showEdit = false"
  />

  <UModal v-model:open="showDeleteConfirm" title="Delete session?">
    <template #body>
      <p class="text-sm">Delete "{{ card.name }}" and its Claude session? This cannot be undone.</p>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton variant="ghost" color="neutral" @click="showDeleteConfirm = false">Cancel</UButton>
        <UButton color="error" @click="confirmDelete">Delete</UButton>
      </div>
    </template>
  </UModal>
</template>
```

- [ ] **Step 7: Add the `fileChipClass` helper**

Add this function in the script section (replaces the old `fileStatusClass` for the new chip styling):

```ts
function fileChipClass(label: string, filePath: string): string {
  if (isFileActive(label)) return 'file-chip--active';
  const status = fileStatuses.value[filePath];
  if (status === 'modified') return 'file-chip--modified';
  if (status === 'missing') return 'file-chip--missing';
  return '';
}
```

- [ ] **Step 8: Commit the template rewrite**

```bash
git add app/components/KanbanCard.vue
git commit -m "feat(KanbanCard): rewrite template to 4-zone layout with dropdown menu"
```

---

### Task 3: Rewrite KanbanCard styles

Replace all scoped styles to match the new zone-based template.

**Files:**
- Modify: `app/components/KanbanCard.vue`

- [ ] **Step 1: Replace the entire `<style scoped>` block**

Remove all existing styles and replace with:

```css
<style scoped>
/* Card container */
.kanban-card {
  background: var(--bg-secondary);
  border: 1px solid var(--bg-tertiary);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  overflow: hidden;
}
.kanban-card:hover { background: var(--bg-tertiary); }
.kanban-card--error { border-color: rgba(247, 118, 142, 0.3); }

/* Zone 1: Identity */
.zone-identity {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--bg-tertiary);
}
.card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.menu-trigger {
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
}
.kanban-card:hover .menu-trigger { opacity: 1; }

/* Zone 2: Description */
.zone-description {
  padding: 6px 12px;
  font-size: 11px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--bg-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Zone 3: Linked Files */
.zone-files {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--bg-tertiary);
}
.file-chip {
  background: rgba(122, 162, 247, 0.12);
  color: var(--accent);
  border: 1px solid rgba(122, 162, 247, 0.2);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  font-family: 'SF Mono', 'Fira Code', monospace;
}
.file-chip:hover {
  background: rgba(122, 162, 247, 0.2);
  border-color: rgba(122, 162, 247, 0.35);
}
.file-chip--active {
  background: rgba(122, 162, 247, 0.2);
  border-color: rgba(122, 162, 247, 0.4);
}
.file-chip--modified {
  background: rgba(224, 175, 104, 0.12);
  color: var(--warning);
  border-color: rgba(224, 175, 104, 0.2);
}
.file-chip--modified:hover {
  background: rgba(224, 175, 104, 0.2);
  border-color: rgba(224, 175, 104, 0.35);
}
.file-chip--missing {
  background: rgba(247, 118, 142, 0.12);
  color: var(--error);
  border-color: rgba(247, 118, 142, 0.2);
  text-decoration: line-through;
}
.file-chip--missing:hover {
  background: rgba(247, 118, 142, 0.2);
  border-color: rgba(247, 118, 142, 0.35);
}
.file-chip-dot { font-size: 8px; }

/* Zone 4: Meta */
.zone-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  font-size: 10px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: var(--text-muted);
}
.meta-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
}
.meta-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.meta-branch {
  color: var(--text-secondary);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta-ahead { color: #4ade80; font-weight: 600; }
.meta-behind { color: #f87171; font-weight: 600; }
.meta-synced { color: var(--text-muted); }
.meta-sep { color: var(--bg-tertiary); }
.meta-issue {
  color: var(--accent);
  font-weight: 600;
  cursor: pointer;
}
.meta-issue:hover { opacity: 0.8; }
</style>
```

- [ ] **Step 2: Verify the card renders correctly**

Run `pnpm tauri dev`. Check:
1. Cards display the 4 zones with visible separators
2. The `⋯` menu appears on hover and opens a dropdown
3. Linked file chips are colored by status
4. The meta line shows branch/issues/cost
5. Error-state cards have a subtle red border
6. Empty zones (no description, no files, no meta) are hidden
7. Click on card opens chat
8. Click on file chip opens file viewer
9. Click on issue number opens GitHub

- [ ] **Step 3: Commit the styles**

```bash
git add app/components/KanbanCard.vue
git commit -m "style(KanbanCard): apply zoned-rows visual design with chip files and meta line"
```

---

### Task 4: Update KanbanColumn to stop passing columnColor

The `columnColor` prop is no longer consumed by `KanbanCard`. Clean up the caller.

**Files:**
- Modify: `app/components/KanbanColumn.vue`

- [ ] **Step 1: Remove the `columnColor` prop from KanbanCard usage**

In `KanbanColumn.vue`, find the `<KanbanCard>` usage inside the `VueDraggable` and remove the `:column-color` prop:

Change:
```vue
<KanbanCard
  :card="item"
  :column-color="flowState.color"
  @fork="openNewSession(item)"
/>
```

To:
```vue
<KanbanCard
  :card="item"
  @fork="openNewSession(item)"
/>
```

Also find the orphan column `KanbanCard` in `KanbanBoard.vue` if it passes `columnColor`, and remove it there too.

- [ ] **Step 2: Verify drag-and-drop still works**

Run `pnpm tauri dev` and test:
1. Drag a card within a column (reorder)
2. Drag a card to a different column (move)
3. Confirm the card renders without the left color border

- [ ] **Step 3: Commit**

```bash
git add app/components/KanbanColumn.vue app/components/KanbanBoard.vue
git commit -m "refactor(KanbanColumn): remove columnColor prop pass-through to KanbanCard"
```

---

### Task 5: Final cleanup and visual polish

Remove any dead code left from the old card design and do a final visual check.

**Files:**
- Modify: `app/components/KanbanCard.vue`

- [ ] **Step 1: Remove the old `fileStatusClass` function**

If the old `fileStatusClass` function is still in the script, remove it — it's replaced by `fileChipClass`.

- [ ] **Step 2: Remove unused imports or variables**

Check that no import or variable is unused after the template rewrite. Specifically verify:
- `CardLinkedIssue` import is still needed (used in `saveEdit` signature)
- `deleteSessionNative` import is still needed (used in `confirmDelete`)
- `BranchStatus` type import is still needed (used in `branchStatus` ref)
- `getFilesGitStatus` and `FileGitStatus` imports are still needed

- [ ] **Step 3: Test all card states end-to-end**

Run `pnpm tauri dev` and verify:
1. **Active card**: Green LED pulses, all 4 zones visible, `⋯` shows Stop action
2. **Idle card**: Hollow LED, zones visible based on data
3. **Error card**: Red LED with glow, subtle red card border
4. **Completed card**: Green checkmark, no stop action in menu
5. **Minimal card** (no desc, no files, no branch): Shows only Zone 1
6. **5 linked files**: Chips wrap correctly within the zone
7. **File chip interactions**: Click opens file viewer, active file highlighted
8. **Issue click**: Opens GitHub in browser
9. **Right-click context menu**: Still works via `CardContextMenu` wrapper
10. **Drag-and-drop**: Still works across columns

- [ ] **Step 4: Commit final cleanup**

```bash
git add app/components/KanbanCard.vue
git commit -m "chore(KanbanCard): remove dead code from old card layout"
```
