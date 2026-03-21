# Tasks: GitHub Issues Integration

## Track A — Infraestructura

### Step 1: Tauri shell permissions for `gh` CLI
- [ ] Add `gh` to `shell:allow-spawn` allow list in `src-tauri/capabilities/default.json`
- [ ] Add `gh` to `shell:allow-execute` allow list in `src-tauri/capabilities/default.json`
- [ ] Verify `gh` can be invoked from frontend via `Command.create()`

### Step 2: Load GitHub config from `.oncraft/config.yaml`
- [ ] Extend `app/services/flow-loader.ts` to read `.oncraft/config.yaml` and extract `github.repository`
- [ ] Add auto-detect fallback: run `gh repo view --json nameWithOwner` in project dir when no manual config
- [ ] Expose `githubRepository` computed in `app/stores/flow.ts` (manual override > auto-detect > undefined)
- [ ] Verify `gh auth status` and expose auth state

### Step 3: GitHub config UI in Project Settings
- [ ] Add "GitHub" section to `app/components/ProjectSettings.vue`
- [ ] Show auto-detected repo as read-only text
- [ ] Add text input for manual override (`owner/repo`)
- [ ] Save override to `.oncraft/config.yaml` via Tauri FS
- [ ] Show auth status indicator (green check / warning)

## Track B — Service + Components

### Step 4: GitHub service (`app/services/github.ts`)
- [ ] Create `app/services/github.ts`
- [ ] Implement `listIssues(repo, query?)` — `gh issue list --json number,title,labels,state`
- [ ] Implement `getIssue(repo, number)` — `gh issue view --json number,title,body,labels,state`
- [ ] Implement `closeIssue(repo, number, comment?)` — `gh issue close`
- [ ] Implement `checkGhStatus()` — `gh auth status`
- [ ] Implement `detectRepo(projectPath)` — `gh repo view --json nameWithOwner`
- [ ] Add in-memory cache with 5min TTL for `listIssues`
- [ ] Add `GitHubIssue` interface to `app/types/index.ts`

### Step 5: IssueSelector component (`app/components/IssueSelector.vue`)
- [ ] Create `app/components/IssueSelector.vue`
- [ ] Props: `repo`, `modelValue` (multi-select), `single` (for create-from-issue)
- [ ] Fetch issues on mount via GitHub service
- [ ] Search input with 300ms debounce (local filter + API search)
- [ ] Display: `#number` + title + labels per row
- [ ] Emit selected issues as `CardLinkedIssue[]`
- [ ] Loading and error states

## Track C — Integration (depends on A + B)

### Step 6: Update EditCardDialog with IssueSelector
- [ ] Replace manual number input in `app/components/EditCardDialog.vue` with `<IssueSelector>`
- [ ] Fix `githubRepo` computed in `app/components/KanbanCard.vue` to read from flow store
- [ ] Verify linked issues show number + title with remove button

### Step 7: "From Issue" in NewSessionDialog
- [ ] Add "Blank" / "From Issue" toggle to `app/components/NewSessionDialog.vue` (visible only when `githubRepo` set)
- [ ] Show IssueSelector in single-select mode when "From Issue" active
- [ ] Pre-fill card name (issue title) and description (issue body, truncated 500 chars)
- [ ] Update emit signature to include `linkedIssues`
- [ ] Update callers to pass `linkedIssues` through to card creation

### Step 8: KanbanCard issue display
- [ ] Add GitHub SVG icon next to issue numbers in `app/components/KanbanCard.vue` footer
- [ ] Make issue badges clickable → open `https://github.com/{repo}/issues/{number}` via Tauri opener
- [ ] Stop event propagation to prevent card edit dialog opening

### Step 9: Close issue on Done
- [ ] Intercept card move to "Done" column (in `app/components/KanbanBoard.vue` or `app/stores/cards.ts`)
- [ ] Show confirmation dialog with checkbox per linked issue
- [ ] On confirm: call `github.closeIssue()` with "Completed via OnCraft" comment
- [ ] On error: show toast, don't block card move

## Independent

### Step 10: TemplateContext + linkedIssues
- [ ] Add `linkedIssues` to `TemplateContext.card` in `app/types/index.ts`
- [ ] Populate `linkedIssues` when building template context in sessions store
