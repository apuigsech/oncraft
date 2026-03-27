# Spec: Fix New Open Project Not Showing on Tabs

## Problem Statement

When a user opens a new project (via the Home screen or the "+" button in the TabBar), the project is correctly persisted to the database and appears in the Home screen's project list, but its tab does **not** appear in the TabBar. The user can navigate to the project's board by clicking on it from the Home screen, but the tab strip doesn't reflect the newly added project until the app is restarted.

### Root Cause

In `app/stores/projects.ts`, the `addProject` action appends the new project to the reactive array using `.push()`:

```ts
projects.value.push(project);
```

The `TabBar.vue` component maintains a local `draggableProjects` ref (required by `vue-draggable-plus`) that is synchronized via a `watch` on `projectsStore.projects`:

```ts
watch(() => projectsStore.projects, (newProjects) => {
  if (syncing) return;
  draggableProjects.value = [...newProjects];
}, { immediate: true });
```

This `watch` does **not** use `{ deep: true }`, so it only triggers when the array reference changes. Since `.push()` mutates the existing array in-place without changing the reference, the watch never fires, and `draggableProjects` is never updated with the new project.

## Requirements

### REQ-1: New project tab appears immediately

When a project is added (via folder picker or Home screen), its tab must appear in the TabBar immediately, without requiring a page reload or navigation away and back.

**Acceptance criteria:**
- AC-1.1: After adding a new project via the "+" button in TabBar, the project tab appears in the tab strip within the same render cycle.
- AC-1.2: After adding a new project via the Home screen's "Open project" button, the project tab appears in the tab strip and becomes the active tab.
- AC-1.3: After adding a new project via the Onboarding wizard, the project tab appears in the tab strip.

### REQ-2: Existing tab behaviors are preserved

The fix must not regress existing TabBar functionality.

**Acceptance criteria:**
- AC-2.1: Drag-and-drop reordering of project tabs continues to work correctly.
- AC-2.2: Closing a project tab removes it from the tab strip.
- AC-2.3: The active tab visual indicator works correctly for all tabs (home, settings, project tabs).
- AC-2.4: The activity dot appears for projects with active sessions.

### REQ-3: Store reactivity is correct

The projects store must maintain proper Vue reactivity for all mutations.

**Acceptance criteria:**
- AC-3.1: `projectsStore.projects` triggers watchers when a project is added.
- AC-3.2: `projectsStore.projects` triggers watchers when a project is removed (already works via `.filter()` which returns a new array).

## Solution

Replace the in-place `.push()` mutation in `addProject()` with a new array assignment:

```ts
// Before (broken):
projects.value.push(project);

// After (fixed):
projects.value = [...projects.value, project];
```

This creates a new array reference, causing the `watch` in `TabBar.vue` to detect the change and update `draggableProjects`.

## Constraints

- **Single-line fix**: The change is isolated to one line in `app/stores/projects.ts:53`.
- **No changes to TabBar.vue**: Adding `{ deep: true }` to the watch would also work but is less idiomatic. The store should produce a new reference on mutation — this is the standard Vue/Pinia pattern.
- **No changes to the database layer**: The persistence is already correct; the bug is purely a frontend reactivity issue.

## Out of Scope

- Refactoring `TabBar.vue`'s `draggableProjects` sync mechanism.
- Adding automated tests (no test infrastructure exists in this project).
- Auditing other store mutations for similar `.push()` patterns (can be a separate card if needed).
- Changes to the `removeProject` action (already uses `.filter()` which returns a new array reference).
