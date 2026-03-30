# MCP DB-First Writes & LinkedFiles Fix

## Problem

Two related bugs caused by the same architectural tension:

### Bug 1: MCP tools fail intermittently

The OnCraft MCP bridge (`handleSessionRequest` in `claude-process.ts`) looks up cards via `cardsStore.cards.find()`. The Pinia store only holds cards for the **currently active project**. When the user switches to another project, `loadForProject()` replaces the entire `cards.value` array, and any running sidecar from the previous project can no longer find its card.

**Symptoms**: `update_current_card` returns `"Card X not found for update (store size: 0, has process: true)"`. `get_current_card` works because it falls back to a static snapshot map.

**Trigger**: User works across multiple projects with active sidecar sessions.

### Bug 2: UI cannot delete or rename linked files

`updateCardLinkedFiles` uses merge semantics (`{ ...existing, ...incoming }`) designed for MCP partial updates. But the UI's EditCardDialog emits a **complete replacement** set. When the user deletes a file entry, the dialog simply omits the key — the merge silently restores it from the existing data.

**Symptoms**:
- Deleting an attached file: disappears in UI, reappears after save
- Renaming a file key: old key persists alongside new one

## Root Cause

Both bugs stem from `cardsStore` being the sole write path:
1. MCP writes fail because the store only holds one project's cards
2. A single `updateCardLinkedFiles` function serves two callers with incompatible semantics (merge vs replace)

## Design

### Principle

All writes from the MCP bridge go through SQLite first. The reactive store is updated as a secondary step only when the card is loaded (active project). This decouples MCP reliability from the UI's project-switching behavior.

### Change 1: DB-first writes for MCP bridge

`handleSessionRequest` for `update_current_card` reads the card from SQLite via a new `db.getCardById(id)` function, applies changes, and writes back to SQLite. After the DB write, it attempts to update the Pinia store if the card is currently loaded — if not, the write still succeeds.

**Flow**:
```
Sidecar MCP tool
  -> handleSessionRequest
  -> db.getCardById(cardId)      // read from SQLite, project-independent
  -> apply field changes
  -> db.updateCard(card)          // persist to SQLite
  -> cardsStore.cards.find(id)    // optional: update reactive store if loaded
  -> send session_response        // always succeeds if DB write succeeded
```

**Column moves** (`columnName` changes) still require the Pinia store because they depend on `flowStore.checkRequiredFiles` and `sessionsStore.fireTriggerPrompt`, which are project-context-dependent. If the card is not in the store (different project active), the column move fails with an explicit error. This is correct behavior — the flow config is project-specific.

**`get_current_card`** also switches to `db.getCardById` as the primary source, eliminating the snapshot fallback.

### Change 2: Split linkedFiles functions

Replace `updateCardLinkedFiles` with two functions:

**`setCardLinkedFiles(cardId, linkedFiles)`** — full replacement, for UI:
- Receives the complete object from EditCardDialog
- Assigns directly: `card.linkedFiles = files` (or `undefined` if empty)
- Called from `KanbanCard.vue`

**`mergeCardLinkedFiles(cardId, linkedFiles)`** — partial merge, for MCP:
- Spreads: `{ ...existing, ...incoming }`
- Filters entries with value `""` (MCP deletion convention)
- Called from `handleSessionRequest` in `claude-process.ts`

Both update `lastActivityAt` and persist to DB.

In the DB-first path (MCP), the merge logic runs inline within `handleSessionRequest` on the card object read from SQLite — it does not call the store's `mergeCardLinkedFiles`. The store function `mergeCardLinkedFiles` exists for any future in-store callers that need merge semantics. In the UI path, `setCardLinkedFiles` operates on the reactive store object (the UI always has the correct project loaded).

### Change 3: No new sync mechanism needed

When the user switches back to a project, `loadForProject(projectId)` already reads all cards from SQLite. Any DB-first writes made by sidecars while the user was in another project are automatically picked up. No polling, events, or watchers required.

### Cleanup

Code removed as part of this change:
- `findLiveCardWithRetry` — no longer needed; DB read replaces store retry
- `cardSnapshots` map — no longer needed; DB is the reliable source
- `findCardForMcp` — replaced by `db.getCardById`

## Files Changed

| File | Change |
|------|--------|
| `app/services/database.ts` | Add `getCardById(id): Promise<Card \| null>` |
| `app/stores/cards.ts` | Split `updateCardLinkedFiles` into `setCardLinkedFiles` + `mergeCardLinkedFiles` |
| `app/services/claude-process.ts` | Rewrite `handleSessionRequest` with DB-first path. Remove `findLiveCardWithRetry`, `findCardForMcp`, `cardSnapshots` |
| `app/components/KanbanCard.vue` | Change `updateCardLinkedFiles` call to `setCardLinkedFiles` |

## Acceptance Criteria

1. MCP `update_current_card` succeeds regardless of which project is active in the UI
2. MCP `get_current_card` succeeds regardless of which project is active in the UI
3. MCP `update_current_card` with `columnName` change fails with explicit error if the card's project is not the active project
4. Deleting a linked file via EditCardDialog persists correctly after save
5. Renaming a linked file key via EditCardDialog does not create a duplicate
6. MCP partial updates to linkedFiles (merge + delete via `""`) continue to work
7. When the user switches back to a project, all MCP-written changes are visible
8. No regressions in card state updates, session ID updates, metrics, or other store operations
