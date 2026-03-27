# Plan: Fix New Open Project Not Showing on Tabs

**Spec**: `.context/agents/spec/fix-new-open-project-not-showing-on-tabs.md`

## Steps

### Step 1: Fix array mutation in projects store

**Files to modify:** `app/stores/projects.ts`

Replace the `.push()` call in the `addProject` action (line 53) with a spread-based array reassignment so that the `ref` produces a new reference on mutation.

```ts
// Line 53 — before:
projects.value.push(project);

// Line 53 — after:
projects.value = [...projects.value, project];
```

This is the only code change required. No other files need modification.

**Satisfies:** REQ-1 (AC-1.1, AC-1.2, AC-1.3), REQ-3 (AC-3.1)

**Dependencies:** None.

### Step 2: Manual verification

No automated test infrastructure exists, so validation is manual. Verify the following scenarios in `pnpm tauri dev`:

| # | Scenario | Expected result | Covers |
|---|----------|----------------|--------|
| 1 | Click "+" in TabBar, select a folder | New tab appears and becomes active | AC-1.1 |
| 2 | From Home screen, click "Open project" | New tab appears and becomes active | AC-1.2 |
| 3 | From Home screen, click an existing project card | Tab becomes active, board loads | AC-2.3 |
| 4 | Drag-reorder project tabs | Order persists after drop | AC-2.1 |
| 5 | Close a project tab via "x" button | Tab disappears, fallback to next tab or home | AC-2.2 |
| 6 | Open a project that already has active sessions | Activity dot visible on tab | AC-2.4 |

**Dependencies:** Step 1 must be applied first.

### Step 3: Commit

Create a single commit on the worktree branch with the one-line fix.

**Dependencies:** Step 2 verification passes.

## Summary

| Aspect | Detail |
|--------|--------|
| Files changed | 1 (`app/stores/projects.ts`) |
| Lines changed | 1 |
| Risk | Minimal — `.filter()` and `.map()` in the same store already use reassignment; this aligns `.push()` to the same pattern |
| Rollback | Revert the single commit |
