# Spec: Triggers When Auto-Moved

## Problem Statement

When a card moves between columns via the MCP tool `update_current_card` (i.e. Claude decides to advance the card), the trigger prompt for the destination state does not fire. Trigger prompts only fire when a card is moved via frontend drag-and-drop (`KanbanColumn.onDragEnd`).

Additionally, the MCP path bypasses the `requiredFiles` validation gate and does not update `columnOrder`, making it an incomplete and inconsistent code path compared to the frontend.

The root cause is duplicated logic: `KanbanColumn.vue` orchestrates validation + move + trigger inline, while `handleSessionRequest` in `claude-process.ts` does a raw field mutation with no awareness of column-move semantics.

## Requirements

### R1: Centralized column-move logic

Create a single method `moveCardToColumn(cardId, toSlug, newOrder?)` in `useCardsStore` that encapsulates the full column-move lifecycle:

1. **Validate `requiredFiles`** -- check via `flowStore.checkRequiredFiles()`. If missing, return failure with the list of missing file slots.
2. **Update card fields** -- set `columnName`, `columnOrder` (use provided value or append to end of target column), and `lastActivityAt`.
3. **Persist to DB** -- call `db.updateCard()`.
4. **Fire trigger prompt** -- call `sessionsStore.fireTriggerPrompt(cardId, fromSlug, toSlug)`.

Return a result object: `{ success: boolean; missingFiles?: string[] }`.

### R2: Frontend drag-and-drop uses centralized method

`KanbanColumn.vue` `onDragEnd()` must call `cardsStore.moveCardToColumn()` instead of directly calling `cardsStore.moveCard()` + `sessionsStore.fireTriggerPrompt()` + `flowStore.checkRequiredFiles()`. The component only handles UI concerns (DOM revert on failure, dialog display).

### R3: MCP `update_current_card` uses centralized method

`handleSessionRequest()` in `claude-process.ts` must detect when `columnName` is changing and delegate to `cardsStore.moveCardToColumn()`. If the move fails due to missing required files, respond with an error to the sidecar (so Claude knows why the move was rejected). Other fields in the same request (name, description, tags, etc.) are still processed normally.

### R4: No-op on same column

If `fromSlug === toSlug`, `moveCardToColumn` returns `{ success: true }` without side effects.

## Acceptance Criteria

- **AC1**: Moving a card via MCP `update_current_card` with `columnName` fires the trigger prompt for the destination state (identical behavior to drag-and-drop).
- **AC2**: Moving a card via MCP `update_current_card` to a state with `requiredFiles` fails with an error response when the card lacks the required linked files.
- **AC3**: Drag-and-drop continues to work identically -- validation, move, trigger, DOM revert on failure.
- **AC4**: The `requiredFiles` check and `fireTriggerPrompt` call each exist in exactly one place (`moveCardToColumn`), not duplicated across callers.
- **AC5**: The old `moveCard(cardId, toColumn, newOrder)` method is removed or made internal, replaced by `moveCardToColumn`.

## Constraints

- No changes to the sidecar (`agent-bridge.ts`) -- the MCP tool schema stays the same.
- No changes to `fireTriggerPrompt()` in `sessionsStore` -- it remains there, just called from a single site.
- No new files -- all changes are to existing files (`cards.ts`, `KanbanColumn.vue`, `claude-process.ts`).
- Cross-store calls (`useFlowStore()`, `useSessionsStore()` inside `cardsStore`) follow the existing pattern of resolving stores lazily inside function bodies.

## Out of Scope

- Changing the trigger prompt template system or template variables.
- Adding new MCP tools or modifying the sidecar protocol.
- Refactoring `handleSessionRequest` beyond the `columnName` handling.
- Adding UI feedback in the Kanban board for MCP-initiated moves (the card already moves reactively).
