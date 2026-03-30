# Implementation Plan: MCP DB-First Writes & LinkedFiles Fix

**Spec**: `docs/superpowers/specs/2026-03-30-mcp-db-first-writes-design.md`

## Step 1: Add `getCardById` to database.ts

**File**: `app/services/database.ts`

Add a new function `getCardById(id: string): Promise<Card | null>` that reads a single card from SQLite by ID, regardless of project. Uses the same row-to-Card mapping as `getCardsByProject` but with `WHERE id = $1` instead of `WHERE project_id = $1`. Returns `null` if not found.

**Dependencies**: None. This is a leaf change.

## Step 2: Split `updateCardLinkedFiles` in cards.ts

**File**: `app/stores/cards.ts`

Replace the existing `updateCardLinkedFiles` function with two:

- **`setCardLinkedFiles(cardId, linkedFiles)`**: Full replacement. Assigns the object directly (or `undefined` if empty). For UI callers.
- **`mergeCardLinkedFiles(cardId, linkedFiles)`**: Merge semantics. Spreads `{ ...existing, ...incoming }`, filters out `""` values. For future in-store callers needing merge.

Both update `lastActivityAt` and persist to DB via `db.updateCard`. Update the store's `return` block to export both new functions instead of the old one.

**Dependencies**: None. Independent of Step 1.

## Step 3: Update KanbanCard.vue to use `setCardLinkedFiles`

**File**: `app/components/KanbanCard.vue`

In the `saveEdit` function (line 143), change `cardsStore.updateCardLinkedFiles(...)` to `cardsStore.setCardLinkedFiles(...)`.

**Dependencies**: Step 2 (new function must exist).

## Step 4: Rewrite `handleSessionRequest` with DB-first path

**File**: `app/services/claude-process.ts`

This is the core change. Rewrite the `handleSessionRequest` function:

### 4a: `get_current_card` — use DB as primary source

Replace `findCardForMcp(cardId)` with `await db.getCardById(cardId)`. No snapshot fallback needed.

### 4b: `update_current_card` — DB-first write path

1. Read card from DB: `const card = await db.getCardById(cardId)`
2. If not found, return error
3. **Column move**: If `req.columnName` differs from current, attempt via store's `moveCardToColumn`. If card not in store, return explicit error ("column move requires active project")
4. **LinkedFiles merge**: If `req.linkedFiles`, apply merge logic inline on the DB card object: `{ ...existing, ...incoming }`, filter `""` values
5. **LinkedIssues**: If `req.linkedIssues`, assign directly on DB card object
6. **Simple scalar fields** (name, description, state, tags, archived): Apply directly on DB card object
7. Write to DB: `await db.updateCard(card)`
8. **Optional store sync**: `cardsStore.cards.find(c => c.id === cardId)` — if found, copy changed fields to the reactive object for immediate UI update
9. Return success response

### 4c: `get_project` — no changes

This action uses `projectsStore` and `flowStore`, not cards. No modification needed.

**Dependencies**: Step 1 (`getCardById` must exist).

## Step 5: Remove dead code from claude-process.ts

**File**: `app/services/claude-process.ts`

Remove:
- `findCardForMcp` function (replaced by `db.getCardById`)
- `findLiveCardWithRetry` function (no longer needed)
- `cardSnapshots` map and all references (lines 108, 254, 267, 284-286)
- Snapshot logic in `spawnSession` (lines 281-286)
- Snapshot cleanup in `close`/`error` handlers

**Dependencies**: Step 4 (must rewrite handler before removing what it depended on). In practice Steps 4 and 5 happen together as a single edit pass.

## Execution Order

```
Step 1 ──┐
         ├──> Step 4+5 (depends on Step 1)
Step 2 ──┤
         └──> Step 3 (depends on Step 2)
```

Steps 1 and 2 are independent and can be done in parallel. Step 3 depends on Step 2. Steps 4+5 depend on Step 1. Steps 3 and 4+5 are independent of each other.

## Verification

After implementation, verify against acceptance criteria:

1. **MCP update across projects**: Open two projects, switch to project B, verify MCP `update_current_card` from project A's sidecar succeeds
2. **MCP read across projects**: Same setup, verify `get_current_card` returns correct data
3. **Column move guard**: Verify `columnName` change fails with clear error when project not active
4. **Delete linked file from UI**: Add a linked file, open edit dialog, delete it, save — verify it stays deleted
5. **Rename linked file from UI**: Add a linked file, open edit dialog, change the key, save — verify no duplicate
6. **MCP merge still works**: Have a sidecar call `update_current_card` with `linkedFiles: { spec: "path" }` — verify it merges correctly
7. **MCP delete via empty string**: Call with `linkedFiles: { spec: "" }` — verify it removes the entry
8. **Project switch reload**: Make MCP changes while on another project, switch back, verify changes visible
