# Spec: GitHub Issues Integration

## Problem Statement

OnCraft currently has basic data structures for linking cards to GitHub issues (`CardLinkedIssue`, `GitHubConfig`, DB columns), and a minimal UI in `EditCardDialog` that only allows typing issue numbers manually. There is no actual GitHub API integration — no issue fetching, no search/selector, no way to create cards from issues, and no lifecycle sync (e.g., closing an issue when a card reaches Done).

This makes the issue linking feature effectively non-functional: users must know issue numbers by heart, get no title/state feedback, and derive no workflow benefit from the link.

## Goals

Turn the existing scaffolding into a fully functional GitHub Issues integration that allows users to:

1. Link their project to a GitHub repository (auto-detected or manual)
2. Browse and search open issues to link them to cards
3. Create new cards directly from GitHub issues
4. See issue references on Kanban cards at a glance
5. Optionally close linked issues when cards move to Done

## Requirements

### R1: GitHub Repository Configuration

**R1.1** — Auto-detect the GitHub repository by running `gh repo view --json owner,name` in the project directory. Display the detected repo in Project Settings as a read-only default.

**R1.2** — Allow manual override of the repository in Project Settings (`owner/repo` text field). The override takes precedence over auto-detection. Persisted in `.oncraft/config.yaml` under `github.repository` (already exists).

**R1.3** — Verify `gh` CLI availability and authentication status (`gh auth status`). If `gh` is not installed or not authenticated, show a non-blocking warning in Project Settings with instructions to run `gh auth login`.

### R2: Issue Fetcher Service

**R2.1** — Create a service (`app/services/github.ts`) that wraps `gh` CLI calls via Tauri shell to:
  - List open issues for the configured repo (with pagination)
  - Search issues by text query
  - Fetch a single issue by number (title, state, body, labels)
  - Close an issue with an optional comment

**R2.2** — All `gh` commands execute via Tauri's `Command` API (shell plugin), not the sidecar. The service returns typed results (`GitHubIssue` interface).

**R2.3** — Cache fetched issues in memory for the session to avoid redundant API calls. Cache invalidated on manual refresh or after 5 minutes.

### R3: Issue Selector Component

**R3.1** — Create an `IssueSelector` component that displays a searchable dropdown/popover of open issues from the configured repo.

**R3.2** — The selector shows: issue number, title, and labels. Supports filtering by typing (searches both locally cached issues and via GitHub API for server-side matches).

**R3.3** — Selecting an issue returns a `CardLinkedIssue` object with `number` and `title` populated.

**R3.4** — The selector is reusable — used in both `EditCardDialog` (link to existing card) and `NewSessionDialog` (create from issue).

### R4: Link Issues to Existing Cards

**R4.1** — Replace the current manual number input in `EditCardDialog` with the `IssueSelector` component. Users search and pick issues from a dropdown instead of typing numbers.

**R4.2** — Multiple issues can still be linked to a single card. Each linked issue shows number, title, and a remove button.

**R4.3** — Clicking an issue reference (anywhere in the UI) opens the issue in the default browser via `https://github.com/{owner}/{repo}/issues/{number}`.

### R5: Create Card from Issue

**R5.1** — Add a "From Issue" button/tab in `NewSessionDialog`. When activated, it shows the `IssueSelector`.

**R5.2** — Selecting an issue pre-fills:
  - Card name = issue title
  - Card description = issue body (truncated to first 500 chars if longer)
  - Linked issue = the selected issue (number + title)

**R5.3** — The user can modify the pre-filled values before confirming. The card is created in the first column (Brainstorm) as usual.

### R6: Kanban Card Display

**R6.1** — Display linked issues on the Kanban card as: GitHub icon + `#42`. If multiple issues, show `#42 #15`.

**R6.2** — Clicking the issue badge opens the issue in the browser.

**R6.3** — The current implementation already shows `#numbers` in the card footer. Update it to include the GitHub icon and make it clickable.

### R7: Close Issue on Done

**R7.1** — When a card with linked issues moves to the "Done" column, show a confirmation dialog: "Close issue #42 on GitHub?" with Yes/No buttons.

**R7.2** — If multiple issues are linked, show checkboxes for each issue so the user can choose which to close.

**R7.3** — On confirmation, close the selected issues via `gh issue close {number} --repo {owner/repo} --comment "Completed via OnCraft"`.

**R7.4** — If the close fails (permissions, network, etc.), show an error notification but don't block the card move. The card still reaches Done.

### R8: MCP Bridge Extension

**R8.1** — Extend the `get_current_card` MCP tool response to include `linkedIssues` data so Claude sessions have access to linked issue context.

**R8.2** — Add `linkedIssues` to the `TemplateContext` type so trigger prompts can reference `{{ card.linkedIssues }}`.

## Acceptance Criteria

- [ ] Auto-detection of GitHub repo works for projects with a GitHub remote
- [ ] Manual override in Project Settings persists and takes precedence
- [ ] Warning shown when `gh` CLI is missing or not authenticated
- [ ] Issue selector shows open issues with search functionality
- [ ] Issues can be linked to existing cards via the selector
- [ ] New cards can be created from GitHub issues with pre-filled data
- [ ] Kanban cards show GitHub icon + issue number(s), clickable to open in browser
- [ ] Moving a card to Done prompts to close linked issues
- [ ] Closing issues via the prompt works and handles errors gracefully
- [ ] Claude sessions can access linked issue data via MCP

## Constraints

- **Authentication**: Only via `gh` CLI. No OAuth flow, no token management in OnCraft.
- **API calls**: All GitHub API interaction goes through `gh` CLI executed via Tauri shell plugin. No direct HTTP calls to GitHub API.
- **Single repo per project**: A project maps to exactly one GitHub repository.

## Out of Scope

- GitHub labels sync (no reading/writing labels from OnCraft)
- Automatic comments on issues when cards change columns (except close on Done)
- Creating GitHub issues from OnCraft
- Pull request integration
- GitLab/Bitbucket support
- Webhooks or real-time sync from GitHub to OnCraft
- Issue assignment or milestone management
- Commenting on issues (except the close comment)
