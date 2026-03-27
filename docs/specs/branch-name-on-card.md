# Spec: Display working branch name on KanbanCard

## Problem statement

When a card uses a git worktree or has a configured git branch, the user has no
way to see which branch is being worked on without opening the card or hovering
over the ahead/behind indicators. The card footer already shows commit
ahead/behind counts, but not the branch name itself. This forces users to
mentally map worktree names to branches or inspect tooltips to orient themselves.

## Requirements

### R1 — Show branch name in the card footer

Display the git branch name in the existing `.branch-status` area of the card
footer, positioned before the ahead/behind indicators.

Layout: `[git-branch-icon] [branch-name] [ahead/behind]`

**Acceptance criteria:**

- AC1.1: A classic git-branch SVG icon (12x12px) is rendered to the left of the
  branch name.
- AC1.2: The branch name text is displayed in the same monospace font and 11px
  size used by the existing branch-status area.
- AC1.3: The branch name appears before (to the left of) the existing
  ahead/behind count indicators.

### R2 — Only show for cards with an explicit branch

The branch name must only appear when the card has a deliberate branch
association, not for every card that happens to be on `main`/`master`.

**Acceptance criteria:**

- AC2.1: The branch name is shown when `card.useWorktree && card.worktreeName`
  is truthy.
- AC2.2: The branch name is shown when `sessionConfig.gitBranch` is set.
- AC2.3: The branch name is NOT shown for cards without a worktree or configured
  git branch (even though `branchStatus` may resolve to `main`).

### R3 — Truncate long branch names

Branch names can be arbitrarily long. The card must remain compact.

**Acceptance criteria:**

- AC3.1: Branch name is truncated with an ellipsis when it exceeds `max-width:
  140px` (approximately 20 characters in the monospace font).
- AC3.2: The full branch name is accessible via a `title` attribute tooltip on
  hover.
- AC3.3: The branch name does not wrap to a second line.

### R4 — Styling consistency

**Acceptance criteria:**

- AC4.1: Branch name text uses `var(--text-secondary)` color to distinguish it
  from the muted ahead/behind indicators.
- AC4.2: The icon uses the same color as the branch name text.
- AC4.3: Visual style is consistent with existing footer elements (`.gh-icon`,
  `.branch-status`).

## Constraints

- **Single file change**: Only `app/components/KanbanCard.vue` is modified
  (template, script, styles).
- **No new data fetching**: The branch name is already available via
  `branchStatus.branch`, fetched by the existing `refreshBranchStatus()`
  function.
- **No new Tauri commands, database changes, or type changes.**

## Out of scope

- Changing or removing the "WT" badge in the card header (it indicates worktree
  mode, which is distinct from the branch name).
- Making the branch name clickable (e.g., to copy or open in GitHub).
- Showing the branch name in the `EditCardDialog` or any other component.
- Changing the ahead/behind indicator behavior or styling.
