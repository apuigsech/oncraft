# Plan: Triggers When Auto-Moved

Spec: `docs/specs/triggers-when-auto-moved.md`

## Step 1: Create `moveCardToColumn()` in `cardsStore`

**File**: `app/stores/cards.ts`

Replace `moveCard()` (lines 72-79) with `moveCardToColumn()`:

```typescript
async function moveCardToColumn(
  cardId: string,
  toSlug: string,
  newOrder?: number,
): Promise<{ success: boolean; missingFiles?: string[] }> {
  const card = cards.value.find(c => c.id === cardId);
  if (!card) return { success: false };

  const fromSlug = card.columnName;
  if (fromSlug === toSlug) return { success: true };

  // 1. requiredFiles gate
  const flowStore = useFlowStore();
  const missing = flowStore.checkRequiredFiles(toSlug, card.linkedFiles);
  if (missing.length > 0) return { success: false, missingFiles: missing };

  // 2. Update fields + persist
  card.columnName = toSlug;
  card.columnOrder = newOrder ?? cardsByColumn(toSlug).length;
  card.lastActivityAt = new Date().toISOString();
  await db.updateCard(card);

  // 3. Fire trigger prompt
  const sessionsStore = useSessionsStore();
  await sessionsStore.fireTriggerPrompt(cardId, fromSlug, toSlug);

  return { success: true };
}
```

Changes:
- Remove old `moveCard` function
- Add `moveCardToColumn` in its place
- Update the store's return object: replace `moveCard` with `moveCardToColumn`
- Add `useSessionsStore` and `useFlowStore` lazy imports inside the function body (follows existing pattern)

**Dependencies**: None (this is the foundation step).

## Step 2: Update `KanbanColumn.vue` to use `moveCardToColumn()`

**File**: `app/components/KanbanColumn.vue`

Simplify `onDragEnd()` (lines 35-71). Remove the inline `requiredFiles` check and `fireTriggerPrompt` call. Replace with a single call to the centralized method:

```typescript
async function onDragEnd(evt: ...) {
  // ... existing slug/card extraction (lines 36-43 unchanged)

  syncing = true;
  try {
    if (fromSlug !== toSlug) {
      const result = await cardsStore.moveCardToColumn(card.id, toSlug, newIndex);
      if (!result.success && result.missingFiles) {
        evt.from.appendChild(evt.to.children[newIndex] ?? evt.data as unknown as Node);
        missingFiles.value = result.missingFiles;
        showRequiredFilesDialog.value = true;
        dragCards.value = [...storeCards.value];
        return;
      }
    } else {
      await cardsStore.applyColumnOrder(props.flowState.slug, dragCards.value);
    }
  } finally {
    dragCards.value = [...storeCards.value];
    syncing = false;
  }
}
```

Key changes:
- Remove lines 45-56 (inline `requiredFiles` gate before `syncing = true`)
- Move `syncing = true` up, before the cross-column check
- Replace `cardsStore.moveCard()` + `sessionsStore.fireTriggerPrompt()` with single `cardsStore.moveCardToColumn()`
- Handle failure result with DOM revert + dialog (same UX, just driven by return value)
- The `sessionsStore` import in `<script setup>` can be removed if no longer used elsewhere in the component (it's only used for `fireTriggerPrompt` currently — verify `sessionsStore.openChat` is not called here; it's not)

**Dependencies**: Step 1 must be complete.

## Step 3: Update `KanbanBoard.vue` to use `moveCardToColumn()`

**File**: `app/components/KanbanBoard.vue`

Change `onOrphanDragEnd()` (line 38) from `cardsStore.moveCard()` to `cardsStore.moveCardToColumn()`. This also gives orphaned card moves the `requiredFiles` validation and trigger firing they were previously missing.

```typescript
const result = await cardsStore.moveCardToColumn(card.id, toSlug, newIndex);
```

No UI change needed — orphaned cards don't have a dialog for missing files, but the move will simply not happen (the card stays in the orphan list). This is acceptable behavior.

**Dependencies**: Step 1 must be complete.

## Step 4: Update `handleSessionRequest()` in `claude-process.ts`

**File**: `app/services/claude-process.ts`

In the `update_current_card` handler (lines 387-401), detect `columnName` changes and delegate to `moveCardToColumn()`:

```typescript
} else if (req.action === 'update_current_card') {
  const card = cardsStore.cards.find(c => c.id === cardId);
  if (card) {
    // Handle column move separately via centralized method
    if (req.columnName !== undefined && req.columnName !== card.columnName) {
      const result = await cardsStore.moveCardToColumn(card.id, req.columnName as string);
      if (!result.success) {
        responseData = { success: false, error: 'Missing required files', missingFiles: result.missingFiles };
        // Send error response and skip remaining field updates
        await proc.write(JSON.stringify({ cmd: 'session_response', requestId: req.requestId, data: responseData }));
        return;
      }
    }

    // Apply remaining non-column fields
    const allowed = ['name', 'description', 'state', 'tags', 'archived', 'linkedFiles', 'linkedIssues'] as const;
    for (const field of allowed) {
      if (req[field] !== undefined) {
        (card as any)[field] = req[field];
      }
    }
    card.lastActivityAt = new Date().toISOString();
    await db.updateCard(card);
    responseData = { success: true, card: { ...card } };
  } else {
    responseData = { success: false, error: 'Card not found' };
  }
}
```

Key changes:
- Extract `columnName` handling before the generic field loop
- Remove `columnName` from the `allowed` array (it's now handled by `moveCardToColumn`)
- On move failure, return early with error (Claude gets a clear error message about missing files)
- Other fields (name, description, tags, etc.) in the same request are still applied normally after a successful move

**Dependencies**: Step 1 must be complete.

## Step 5: Remove unused import

**File**: `app/components/KanbanColumn.vue`

Remove `const sessionsStore = useSessionsStore();` (line 8) since `fireTriggerPrompt` is no longer called directly from this component. Verify no other references to `sessionsStore` exist in the component first.

**Dependencies**: Step 2 must be complete.

## Execution Order

Steps 2, 3, and 4 are independent of each other but all depend on Step 1. Step 5 depends on Step 2.

```
Step 1 (cards.ts)
  ├── Step 2 (KanbanColumn.vue)
  │     └── Step 5 (cleanup import)
  ├── Step 3 (KanbanBoard.vue)
  └── Step 4 (claude-process.ts)
```

## Files Modified

| File | Change |
|------|--------|
| `app/stores/cards.ts` | Replace `moveCard` with `moveCardToColumn` |
| `app/components/KanbanColumn.vue` | Simplify `onDragEnd` to use centralized method |
| `app/components/KanbanBoard.vue` | Update `onOrphanDragEnd` to use centralized method |
| `app/services/claude-process.ts` | Delegate `columnName` changes to centralized method |

No new files created.
