# Plan: File viewer scoped to its project tab

**Spec:** spec.md

## Overview

This is a single-file fix. The entire change is in `app/composables/useFileViewer.ts`. No other files need modification because the public API shape is preserved (R4).

## Steps

### Step 1: Replace global ref with per-project reactive Map

**File:** `app/composables/useFileViewer.ts`

**What to do:**
- Remove the module-level `const activeFile = ref<...>(null)` (single global state).
- Replace it with `const fileByProject = reactive(new Map<string, { label, path, cardId }>())` at module scope.
- The Map is keyed by `projectId` and each value is the file info for that project.

**Why module scope:** The state must persist across all component instances that call `useFileViewer()`, same pattern as before — just swapping a `ref` for a `reactive(Map)`.

**Dependencies:** None.

### Step 2: Derive `activeFile` as a computed from the Map

**File:** `app/composables/useFileViewer.ts`

**What to do:**
- Inside `useFileViewer()`, obtain `projectsStore` via `useProjectsStore()`.
- Define `activeFile` as a `computed` that reads `projectsStore.activeProjectId` and looks up the corresponding entry in `fileByProject`.
- Returns `null` when no project is active or no file is open for the active project.

**Dependencies:** Step 1 (the Map must exist).

### Step 3: Scope `openFile()` and `closeFile()` to active project

**File:** `app/composables/useFileViewer.ts`

**What to do:**
- `openFile(cardId, label, path)`: read `activeProjectId`, early-return if null, then `fileByProject.set(pid, ...)`.
- `closeFile()`: read `activeProjectId`, early-return if null, then `fileByProject.delete(pid)`.

**Dependencies:** Step 1 (the Map must exist), Step 2 (for consistency, though these are independent functions).

### Step 4: Return the computed instead of `readonly(ref)`

**File:** `app/composables/useFileViewer.ts`

**What to do:**
- Return `activeFile` (the computed) directly instead of `readonly(activeFile)`.
- A `computed` is already read-only, so `readonly()` wrapper is unnecessary.

**Dependencies:** Step 2.

## Verification

### Manual test procedure

1. Open two projects (Project A, Project B) in separate tabs.
2. On Project A, open a linked file from a card — FileViewer should appear.
3. Click Project B's tab — should show Project B's board, not Project A's file.
4. Click Project A's tab — should restore Project A's file viewer.
5. On Project B, open a different file — both projects now have independent files open.
6. Close the file on Project B — Project B shows board, Project A still shows its file.

### What should NOT change

- `app.vue`: no edits needed. The `v-if="activeFile"` condition works as before.
- `KanbanCard.vue`: no edits needed. `openFile()` and `activeFile` API are the same.
- `FileViewer.vue`: no edits needed. Props are passed from `app.vue` identically.

## Files modified

| File | Action |
|------|--------|
| `app/composables/useFileViewer.ts` | Modified (all 4 steps) |

## Status

Implementation was completed during the Brainstorm phase. All steps are already applied in the working tree (see `git diff`). The Implement phase should verify correctness and commit.
