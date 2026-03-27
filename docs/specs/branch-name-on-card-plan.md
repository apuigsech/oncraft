# Plan: Display working branch name on KanbanCard

**Spec**: `docs/specs/branch-name-on-card.md`
**File to modify**: `app/components/KanbanCard.vue`

All steps modify the single file `app/components/KanbanCard.vue`. The steps are
ordered by dependency — each builds on the previous.

## Step 1 — Add `hasExplicitBranch` computed property

**Section**: `<script setup>`
**Depends on**: nothing

Add a computed that returns `true` when the card has a deliberate branch
association. This controls whether the branch name is rendered.

```ts
const hasExplicitBranch = computed(() => {
  if (props.card.useWorktree && props.card.worktreeName) return true;
  const config = sessionsStore.getSessionConfig(props.card.id);
  return !!config.gitBranch;
});
```

**Covers**: AC2.1, AC2.2, AC2.3

## Step 2 — Add branch name to the template

**Section**: `<template>`, inside the existing `.branch-status` div
**Depends on**: Step 1

Restructure the existing `v-if="branchStatus"` div to also check
`hasExplicitBranch`. Add the git-branch SVG icon and a truncated branch name
span before the existing ahead/behind indicators.

```html
<div
  v-if="branchStatus && hasExplicitBranch"
  class="branch-status"
  :title="`${branchStatus.branch} vs ${branchStatus.base}`"
>
  <svg class="branch-icon" viewBox="0 0 16 16" fill="currentColor">
    <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.5 2.5 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Z" />
  </svg>
  <span class="branch-name" :title="branchStatus.branch">
    {{ branchStatus.branch }}
  </span>
  <span v-if="branchStatus.ahead > 0" class="commits-ahead">&uarr;{{ branchStatus.ahead }}</span>
  <span v-if="branchStatus.behind > 0" class="commits-behind">&darr;{{ branchStatus.behind }}</span>
  <span v-if="branchStatus.ahead === 0 && branchStatus.behind === 0" class="commits-synced">&check;</span>
</div>
```

Note: The outer `v-if` condition changes from `branchStatus` to
`branchStatus && hasExplicitBranch`, gating visibility per R2.

**Covers**: AC1.1, AC1.2, AC1.3, AC2.3

## Step 3 — Add CSS styles for icon and branch name

**Section**: `<style scoped>`
**Depends on**: Step 2

```css
.branch-icon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  color: var(--text-secondary);
}
.branch-name {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
}
```

**Covers**: AC3.1, AC3.2, AC3.3, AC4.1, AC4.2, AC4.3

## Verification

After implementation, verify with `pnpm tauri dev`:

1. A worktree card shows `[icon] branch-name ↑N ↓N` in the footer.
2. A card without worktree or gitBranch does NOT show the branch area.
3. A long branch name truncates with ellipsis; hovering reveals the full name.
4. Styling matches the existing monospace/11px footer elements.
