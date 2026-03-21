# Session Fork — Design Spec

## Summary

Add the ability to fork a card, creating a new card whose Claude session inherits the full conversation history of the parent. This lets users explore alternative approaches from the same point without losing context.

## Motivation

When working on a feature, users sometimes want to try two different approaches in parallel. Today, the only option is to create a new card from scratch, losing all prior conversation context. Forking solves this by branching the conversation — the new card starts with the same history and diverges from there.

Agent-Deck implements a similar concept. The Claude Agent SDK natively supports it via `resume` + `forkSession: true`.

## Design

### Data model

Add one optional field to `Card` in `app/types/index.ts`:

```typescript
forkedFromId?: string;  // ID of the parent card (undefined for non-forks)
```

SQLite migration in `database.ts` (follows existing `ALTER TABLE` + try/catch pattern):

```sql
ALTER TABLE cards ADD COLUMN forked_from_id TEXT DEFAULT ''
```

Empty string means "no parent", consistent with the existing convention for `worktree_name` and `console_session_id`. The read-mapping in `getCardsByProject` converts `''` to `undefined` (same pattern as `worktreeName`: `r.forked_from_id || undefined`).

### Database changes (detailed)

Three SQL functions in `database.ts` need modification:

1. **`insertCard`** — Add `forked_from_id` as a new column in the INSERT statement (parameter $14).
2. **`updateCard`** — Add `forked_from_id` to the UPDATE SET clause.
3. **`getCardsByProject`** — Add `forked_from_id` to the row type and map `r.forked_from_id || undefined` to `forkedFromId` in the returned `Card` object.

### UX flow

1. Right-click a card to open the context menu.
2. New menu item: **Fork** (icon: `i-lucide-git-branch`), placed between "Edit" and the divider.
3. Clicking "Fork" opens `NewSessionDialog` pre-filled with:
   - Name: `"{parentName} (fork)"`
   - Description: same as parent
   - Worktree checkbox: unchecked (user decides)
4. User edits fields and confirms.
5. New card is created in the **same column** as the parent, with `forkedFromId` set.

### Event propagation

The fork event originates in `CardContextMenu` and needs to reach `KanbanColumn` where `NewSessionDialog` already lives. The chain:

1. **`CardContextMenu.vue`** — New "Fork" button emits `fork` event with `cardId`.
2. **`KanbanCard.vue`** — Listens for `fork` from `CardContextMenu`, emits `fork` event upward with the full `Card` object (name, description, sessionId, id).
3. **`KanbanColumn.vue`** — Listens for `fork` from `KanbanCard`. This is where the dialog lives (consistent with existing `createSession` pattern). Sets fork-mode state: stores the parent card data and opens `NewSessionDialog` with pre-fill props.

`KanbanBoard.vue` does **not** handle the fork event — it stays in `KanbanColumn` for consistency with the existing card creation architecture.

### NewSessionDialog changes

Add optional props for pre-filling in fork mode:

```typescript
defineProps<{
  initialName?: string;
  initialDescription?: string;
}>();
```

When these props are provided, the dialog initializes `name` and `description` refs from them. The `create` emit signature stays the same — the caller (`KanbanColumn`) handles adding `forkedFromId` when creating the card.

### Store changes

**`cards.ts`** — `addCard` accepts an optional `forkedFromId` parameter:

```typescript
async function addCard(
  projectId: string, columnName: string, name: string,
  description: string, useWorktree?: boolean, forkedFromId?: string
): Promise<Card>
```

The `Card` object constructed inside includes `forkedFromId` and `db.insertCard` persists it.

**`sessions.ts`** — Fork detection in `send()`. The session ID resolution block (currently lines 236-237) gains fork-aware logic:

```typescript
// Determine session ID for resume
let sessionId = card?.sessionId && !card.sessionId.startsWith('pending-')
  ? card.sessionId : undefined;

// Fork detection: first message on a forked card with no own session yet
let forkSession = false;
if (!sessionId && card?.forkedFromId) {
  const parentCard = cardsStore.cards.find(c => c.id === card.forkedFromId);
  if (parentCard?.sessionId && !parentCard.sessionId.startsWith('pending-')) {
    sessionId = parentCard.sessionId;  // Use PARENT's sessionId for resume
    forkSession = true;
  }
}
```

This is a **one-time substitution**: after the first message, the SDK returns a new `sessionId` via the `init` message, which gets stored on the forked card. Subsequent `send()` calls find the card's own `sessionId` and skip the fork branch entirely.

### Sidecar/SDK interface

**`claude-process.ts`** — `spawnSession` and `sendStart` accept `forkSession` via the existing `config` parameter or as a dedicated option. To avoid growing the positional parameter list (already 7 params), add `forkSession` to the start command JSON construction:

```typescript
const startCmd = JSON.stringify({
  cmd: 'start',
  // ...existing fields...
  ...(forkSession ? { forkSession: true } : {}),
});
```

The `forkSession` boolean is passed from `sessions.ts` `send()` down to `spawnSession`/`sendStart` as an additional parameter. Both functions already use spread objects for optional fields, so this is one more spread entry.

**`agent-bridge.ts`** — Reads `forkSession` from the start command and passes it to the SDK:

```typescript
const queryOptions = {
  // ...existing options...
  resume: cmd.sessionId ? (cmd.sessionId as string) : undefined,
  forkSession: cmd.forkSession ? true : undefined,
};
```

### Visual indicator

Forked cards show a small badge in the card header, similar to the existing "WT" worktree badge:

```html
<UBadge
  v-if="card.forkedFromId"
  variant="soft"
  color="warning"
  size="xs"
  class="fork-badge"
  :title="'Forked from ' + parentCardName"
>Fork</UBadge>
```

The parent card name is resolved via a computed property that looks up the parent in the cards store. If the parent has been deleted, the tooltip falls back to just "Fork".

### Edge cases

- **Parent deleted**: The forked card continues working — its session is independent. `forkedFromId` points to a non-existent card; the badge shows "Fork" without parent name in tooltip.
- **Parent has no session yet**: Fork creates a normal card. On first `send()`, the fork detection finds no parent `sessionId`, so it starts a fresh session without resume/forkSession.
- **Fork of a fork**: Works naturally. `forkedFromId` points to the immediate parent. The fork detection looks up that parent's `sessionId` for resume.
- **Second message after fork**: The forked card already has its own `sessionId` (received from the SDK `init` message after the first query). The fork detection branch is skipped — it behaves like any normal card.

### Files touched

| File | Change |
|------|--------|
| `app/types/index.ts` | Add `forkedFromId` to `Card` interface |
| `app/services/database.ts` | Migration + update `insertCard`, `updateCard`, `getCardsByProject` |
| `app/stores/cards.ts` | `addCard` accepts `forkedFromId` param |
| `app/stores/sessions.ts` | Fork detection in `send()`: parent sessionId substitution + `forkSession` flag |
| `app/services/claude-process.ts` | Thread `forkSession` through `spawnSession`/`sendStart` to start command JSON |
| `src-sidecar/agent-bridge.ts` | Read `forkSession` from start command, pass to SDK query options |
| `app/components/CardContextMenu.vue` | Add "Fork" menu item emitting `fork` event |
| `app/components/KanbanCard.vue` | Relay fork event with full card data, show fork badge |
| `app/components/KanbanColumn.vue` | Handle fork event: open `NewSessionDialog` in fork mode, create card with `forkedFromId` |
| `app/components/NewSessionDialog.vue` | Accept `initialName`/`initialDescription` props for pre-fill |

### Out of scope

- Visual fork tree / parent-child connectors
- Merge-back functionality (git merge from fork to parent)
- Fork staleness checks (Agent-Deck's 5-minute window)
- Standalone `forkSession()` SDK function for pre-creating fork sessions (the simpler `resume` + `forkSession: true` on first query is sufficient)
