# Plan: GitHub Issues Integration

## Current State Summary

The codebase already has partial scaffolding:
- **Types defined**: `CardLinkedIssue`, `GitHubConfig`, `ProjectConfig` in `app/types/index.ts`
- **DB column exists**: `linked_issues TEXT DEFAULT '[]'` with JSON serialization
- **Cards store**: `updateCardLinkedIssues()` implemented
- **EditCardDialog**: Issue linking UI exists but hidden (gated by `githubRepo` which is always `undefined`)
- **KanbanCard**: Issue display exists in footer (`#42 #15` format) but unreachable
- **MCP tools**: `get_current_card` returns `linkedIssues`, `update_current_card` can write them
- **Config file**: `.oncraft/config.yaml` has `github.repository` but nothing reads it
- **BROKEN**: `pipelinesStore.getConfig()` intentionally omits `github` config. No code reads `config.yaml`.
- **MISSING**: No `gh` CLI permission in Tauri, no GitHub API service, no IssueSelector component, no "From Issue" in NewSessionDialog, no close-on-Done flow, `TemplateContext` lacks `linkedIssues`

## Implementation Steps

### Step 1: Add `gh` CLI permission to Tauri shell

**Goal**: Allow the frontend to execute `gh` commands via Tauri's shell plugin.

**Files to modify**:
- `src-tauri/capabilities/default.json` — Add `gh` to `shell:allow-spawn` and `shell:allow-execute` allow list

**Details**:
- Add `{ "name": "gh", "cmd": "gh" }` (or the appropriate Tauri shell scope format) to both spawn and execute permissions
- This unblocks all subsequent steps that need `gh` CLI access

**Dependencies**: None

---

### Step 2: Load GitHub config from `.oncraft/config.yaml`

**Goal**: Make the `github.repository` value from config available to the frontend.

**Files to modify**:
- `app/services/flow-loader.ts` — Extend to also read `config.yaml` and extract `github` section
- `app/stores/flow.ts` — Expose `githubRepository` computed from the loaded config
- `app/stores/projects.ts` — (Alternative) Add a `getGitHubRepo(projectPath)` method that reads the config

**Details**:
- The simplest approach: extend `flow-loader.ts` to read `.oncraft/config.yaml` alongside `flow.yaml` and expose the `github.repository` field
- Store it in the flow store since it already manages `.oncraft/` directory contents
- Auto-detect fallback: if `github.repository` is not set in config, run `gh repo view --json nameWithOwner` in the project directory as fallback
- Expose a `githubRepository` computed in the store that returns: manual override > auto-detected > undefined

**Dependencies**: Step 1 (for auto-detect fallback via `gh`)

---

### Step 3: Add GitHub config UI to Project Settings

**Goal**: Show detected/configured GitHub repo and allow manual override.

**Files to modify**:
- `app/components/ProjectSettings.vue` — Add GitHub repository section

**Details**:
- New section "GitHub" in the settings dialog
- Show auto-detected repo (from `gh`) as grey read-only text
- Text input for manual override (`owner/repo`), saved to `.oncraft/config.yaml`
- Status indicator: green check if `gh auth status` succeeds, warning icon + message if `gh` not available or not authenticated
- Save override by writing to `.oncraft/config.yaml` (using Tauri FS plugin)

**Dependencies**: Step 2

---

### Step 4: Create GitHub service (`app/services/github.ts`)

**Goal**: Service that wraps `gh` CLI calls for issue operations.

**Files to create**:
- `app/services/github.ts`

**Details**:
- `listIssues(repo: string, query?: string): Promise<GitHubIssue[]>` — runs `gh issue list --repo {repo} --json number,title,labels,state --limit 50` (with optional `--search` for query)
- `getIssue(repo: string, number: number): Promise<GitHubIssue>` — runs `gh issue view {number} --repo {repo} --json number,title,body,labels,state`
- `closeIssue(repo: string, number: number, comment?: string): Promise<void>` — runs `gh issue close {number} --repo {repo} --comment "{comment}"`
- `checkGhStatus(): Promise<{ installed: boolean; authenticated: boolean }>` — runs `gh auth status`
- `detectRepo(projectPath: string): Promise<string | null>` — runs `gh repo view --json nameWithOwner` in project dir
- All commands via `Command.create()` from `@tauri-apps/plugin-shell`
- In-memory cache with 5-minute TTL for `listIssues` results
- Add `GitHubIssue` interface to `app/types/index.ts`: `{ number: number; title: string; body?: string; labels: string[]; state: string }`

**Dependencies**: Step 1

---

### Step 5: Create IssueSelector component

**Goal**: Reusable searchable dropdown for picking GitHub issues.

**Files to create**:
- `app/components/IssueSelector.vue`

**Details**:
- Props: `repo: string`, `modelValue?: CardLinkedIssue[]` (for multi-select), `single?: boolean` (for create-from-issue mode)
- Uses the GitHub service to fetch/search issues
- Dropdown/popover with search input at the top
- Each row shows: `#number` + title + labels (as colored chips)
- Typing filters locally first, then triggers API search after 300ms debounce
- Emits selected issue(s) as `CardLinkedIssue` objects (number + title)
- Loading state while fetching
- Error state if `gh` fails (with "Check gh auth" hint)
- Can use Nuxt UI's `USelectMenu` or `UPopover` as base

**Dependencies**: Step 4

---

### Step 6: Update EditCardDialog to use IssueSelector

**Goal**: Replace manual number input with the IssueSelector component.

**Files to modify**:
- `app/components/EditCardDialog.vue` — Replace the manual `<input type="number">` + Add button with `<IssueSelector>`
- `app/components/KanbanCard.vue` — Fix `githubRepo` computed to read from the new store location (Step 2)

**Details**:
- Remove the manual number input and "Add" button
- Add `<IssueSelector :repo="githubRepo" v-model="localLinkedIssues" />` in the GitHub section
- The `v-if="githubRepo"` guard stays — section only shows when a repo is configured
- Fix `KanbanCard.vue` `githubRepo` computed to use the flow store's `githubRepository` instead of the broken `pipelinesStore.getConfig()?.github?.repository`
- Each linked issue now shows: `#number title` with remove button (same layout, but titles are now populated from the selector)

**Dependencies**: Step 5, Step 2

---

### Step 7: Add "From Issue" to NewSessionDialog

**Goal**: Allow creating a card directly from a GitHub issue.

**Files to modify**:
- `app/components/NewSessionDialog.vue` — Add "From Issue" tab/toggle and IssueSelector

**Details**:
- Add a toggle or tab at the top: "Blank" | "From Issue" (only visible when `githubRepo` is configured)
- When "From Issue" is selected, show the IssueSelector in single-select mode
- On issue selection, pre-fill: name = issue title, description = issue body (first 500 chars)
- User can still edit name/description before confirming
- Update emit signature to include `linkedIssues?: CardLinkedIssue[]`
- Update caller in `KanbanCard.vue` or wherever `NewSessionDialog` is used to pass `linkedIssues` through to card creation

**Dependencies**: Step 5, Step 2

---

### Step 8: Update KanbanCard issue display

**Goal**: Show GitHub icon + `#42` on cards, make it clickable.

**Files to modify**:
- `app/components/KanbanCard.vue` — Update issue display in footer

**Details**:
- Replace current `#42` text with GitHub icon (SVG or from icon set) + `#42`
- Wrap each issue reference in a clickable element that opens `https://github.com/{repo}/issues/{number}` via Tauri opener plugin
- If multiple issues: show `[icon]#42 #15` (all inline)
- Stop event propagation on click to prevent opening the card edit dialog

**Dependencies**: Step 2 (for `githubRepo`)

---

### Step 9: Close issue on Done — confirmation dialog

**Goal**: When a card with linked issues moves to Done, prompt to close them.

**Files to modify**:
- `app/components/KanbanBoard.vue` or `app/stores/cards.ts` — Intercept column move to Done
- New component or inline dialog for the confirmation

**Details**:
- When `moveCard()` or equivalent detects the target column is "Done" and the card has `linkedIssues`, show a dialog
- Dialog content: "Close linked issues on GitHub?" with a checkbox per issue (`#42 Fix login redirect`)
- "Close selected" and "Skip" buttons
- On confirm: call `github.closeIssue()` for each checked issue with comment "Completed via OnCraft"
- On error: show toast notification but don't block the card move
- The card move happens regardless of the dialog outcome
- Consider: the dialog should appear AFTER the card has been moved (or at least not block the drag operation). A modal that appears on drop is the simplest approach.

**Dependencies**: Step 4

---

### Step 10: Extend TemplateContext with linkedIssues

**Goal**: Make linked issues available in trigger prompt templates.

**Files to modify**:
- `app/types/index.ts` — Add `linkedIssues` to `TemplateContext.card`
- `app/stores/sessions.ts` (or wherever the template context is built) — Populate `linkedIssues` in the context

**Details**:
- Add `linkedIssues?: Array<{ number: number; title?: string }>` to `TemplateContext.card`
- When building the context for trigger prompts, include the card's `linkedIssues`
- Templates can then use `{{ card.linkedIssues }}` to reference issue data
- The MCP tools already return linkedIssues (verified in exploration), so no changes needed there

**Dependencies**: None (can be done in parallel with other steps)

---

## Step Dependency Graph

```
Step 1 (Tauri shell permissions)
  ├── Step 2 (Load GitHub config)
  │     ├── Step 3 (ProjectSettings UI)
  │     ├── Step 6 (EditCardDialog update)
  │     ├── Step 7 (NewSessionDialog "From Issue")
  │     └── Step 8 (KanbanCard display)
  └── Step 4 (GitHub service)
        ├── Step 5 (IssueSelector component)
        │     ├── Step 6 (EditCardDialog update)
        │     └── Step 7 (NewSessionDialog "From Issue")
        └── Step 9 (Close on Done dialog)

Step 10 (TemplateContext) — independent, can run in parallel
```

## Parallelization Opportunities

- **Step 2 + Step 4** can run in parallel after Step 1
- **Step 3 + Step 5** can run in parallel (different files, different dependencies)
- **Step 10** is fully independent
- **Steps 6, 7, 8** depend on both Step 2 and Step 5, so they come after both tracks converge
- **Step 9** only depends on Step 4

## Estimated Scope

| Step | New Files | Modified Files | Complexity |
|------|-----------|----------------|------------|
| 1 | 0 | 1 | Low |
| 2 | 0 | 2 | Medium |
| 3 | 0 | 1 | Medium |
| 4 | 1 | 1 | Medium |
| 5 | 1 | 0 | High |
| 6 | 0 | 2 | Medium |
| 7 | 0 | 1 | Medium |
| 8 | 0 | 1 | Low |
| 9 | 0 | 2 | Medium |
| 10 | 0 | 2 | Low |

**Total**: 2 new files, ~13 file modifications
