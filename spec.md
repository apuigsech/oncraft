# Spec: File viewer scoped to its project tab

## Problem statement

The FileViewer overlay uses a single global `activeFile` ref shared across all project tabs. When a user opens a file in Project A and then switches to Project B's tab, the FileViewer from Project A remains visible instead of showing Project B's board (or Project B's own file viewer). This breaks the mental model that each tab is an independent workspace.

## Requirements

### R1: Per-project file viewer state

Each project tab maintains its own independent file viewer state. Opening a file on one project does not affect any other project's tab.

**Acceptance criteria:**
- Opening a file on Project A and switching to Project B shows Project B's board (not Project A's file).
- Switching back to Project A restores its file viewer with the previously opened file.
- Each project can have its own file open simultaneously without interference.

### R2: File viewer visibility follows active project

The FileViewer in `app.vue` only renders when the **current active project** has an open file, not when any project has one.

**Acceptance criteria:**
- `activeFile` returns `null` when the active project has no open file, even if other projects do.
- The `v-if="activeFile"` condition in `app.vue` correctly gates the FileViewer per project.

### R3: Close file only affects current project

Calling `closeFile()` only clears the file viewer state for the currently active project.

**Acceptance criteria:**
- Closing a file on Project A does not close a file that was open on Project B.
- After closing, the board is shown for that project while other projects retain their state.

### R4: API compatibility

The public API of `useFileViewer()` (`activeFile`, `openFile`, `closeFile`) remains unchanged so that existing consumers (`app.vue`, `KanbanCard.vue`) require no modifications.

**Acceptance criteria:**
- `app.vue` and `KanbanCard.vue` work without any code changes.
- `activeFile` is still a reactive ref-like object (computed) with the same shape `{ label, path, cardId } | null`.

## Constraints

- The composable must access `useProjectsStore().activeProjectId` to determine the current project context.
- State is stored in a reactive `Map<projectId, fileInfo>` at module scope (outside the composable function) so it persists across component instances.

## Out of scope

- Persisting file viewer state across app restarts (it remains in-memory only, same as before).
- File viewer for projects that have been removed — orphaned entries in the map are harmless and will be garbage-collected if the project is re-added.
- Changes to `FileViewer.vue`, `KanbanCard.vue`, or `app.vue` — the fix is entirely within `useFileViewer.ts`.
