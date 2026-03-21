# Persistent Cost Display

## Summary

Persist session cost metrics (cost, tokens, duration) in SQLite and display them on Kanban cards and in the ChatPanel header. Metrics survive app restarts.

## Scope

- **In scope:** SQLite persistence of cost metrics, Kanban card footer display, persistent ChatPanel header metrics, fix token accumulation bug
- **Out of scope:** Cost dashboard, budgets, alerts, cost-aware routing, per-query event log, time-series charts

## Current State

- The sidecar emits `costUsd`, `inputTokens`, `outputTokens`, `durationMs` in `result` messages
- `sessions.ts` accumulates these in an in-memory `sessionMetrics` reactive map — lost on app restart
- `costUsd` and `durationMs` accumulate correctly (`+=`), but `inputTokens` and `outputTokens` are replaced (`=`) on each query — a bug
- `SessionMetrics.vue` displays metrics in the ChatPanel header, but starts at zero on every app launch
- No SQLite columns or tables store cost data

## Design

### 1. Schema Migration

Add four columns to the existing `cards` table using the established migration pattern (`ALTER TABLE` wrapped in try/catch):

```sql
ALTER TABLE cards ADD COLUMN cost_usd REAL DEFAULT 0;
ALTER TABLE cards ADD COLUMN input_tokens INTEGER DEFAULT 0;
ALTER TABLE cards ADD COLUMN output_tokens INTEGER DEFAULT 0;
ALTER TABLE cards ADD COLUMN duration_ms INTEGER DEFAULT 0;
```

Location: `app/services/database.ts`, appended to the existing migration block.

### 2. Type Changes

Add four optional fields to the `Card` interface in `app/types/index.ts`:

```typescript
costUsd?: number;
inputTokens?: number;
outputTokens?: number;
durationMs?: number;
```

### 3. Fix Token Accumulation

In `app/stores/sessions.ts`, `handleMeta()` — change token assignment from replacement to accumulation:

```typescript
// Before (bug):
m.inputTokens = usage.inputTokens || m.inputTokens;
m.outputTokens = usage.outputTokens || m.outputTokens;

// After (fix):
m.inputTokens += usage.inputTokens || 0;
m.outputTokens += usage.outputTokens || 0;
```

### 4. Persist Flow

When `handleMeta()` processes a `result` message:

1. Accumulate in `sessionMetrics[cardId]` (in-memory, as now — with the token fix)
2. Update the `Card` object in-memory (so `KanbanCard.vue` reactively re-renders)
3. Call `cardsStore.updateCardMetrics(cardId, metrics)` which triggers `_debouncedDbWrite(card)` — the same debounced write path used by `updateCardState`

The `updateCardMetrics` method in `app/stores/cards.ts`:

```typescript
async function updateCardMetrics(cardId: string, metrics: { costUsd: number; inputTokens: number; outputTokens: number; durationMs: number }) {
  const card = cards.value.find(c => c.id === cardId);
  if (!card) return;
  card.costUsd = metrics.costUsd;
  card.inputTokens = metrics.inputTokens;
  card.outputTokens = metrics.outputTokens;
  card.durationMs = metrics.durationMs;
  _debouncedDbWrite(card); // reuses existing debounced write path
}
```

**Important:** The existing `updateCard()` SQL in `database.ts` explicitly enumerates columns — it does not use `SET *`. The `UPDATE` statement and the row-to-object mapping in `getCardsByProject()` must both be extended to include the four new cost columns. Without this, the persist and load flows silently fail.

### 5. Load from DB

In `cards.ts` `loadForProject()`: the existing `SELECT *` already returns the new columns. Map them to the `Card` object.

In `sessions.ts`: when a chat is opened for a card, initialize `sessionMetrics[cardId]` from the card's persisted values instead of zeros. This makes `SessionMetrics.vue` in the ChatPanel header show persisted data immediately.

### 6. Kanban Card Footer

In `app/components/KanbanCard.vue`, add a conditional footer:

- **Visibility:** only when `card.costUsd > 0`
- **Content:** `$0.0342  ↑12k ↓8k` (cost + input tokens + output tokens)
- **Style:** monospace, 10px, color `#64748b`, separated by a subtle `border-top`
- **Token format:** displayed in "k" (thousands), rounded. Values under 100 shown as exact numbers.

### 7. Purge / Reset

When `purgeCard(cardId)` is called (card archived/removed):
- Reset `sessionMetrics[cardId]` to zeros (existing behavior)
- Reset cost columns on the `Card` object
- The debounced persist writes zeros to SQLite

Metrics represent the **total accumulated cost of the card** across all sessions. They do not reset when a new session starts on the same card.

## Files Changed

| File | Change |
|------|--------|
| `app/services/database.ts` | Add 4 `ALTER TABLE ADD COLUMN` migrations, extend `updateCard()` SQL and `getCardsByProject()` row mapping to include cost columns |
| `app/types/index.ts` | Add 4 optional fields to `Card` interface |
| `app/stores/sessions.ts` | Fix token accumulation (`+=`), persist call after `handleMeta`, init from DB on chat open |
| `app/stores/cards.ts` | Add `updateCardMetrics()` with debounced SQLite UPDATE, map new columns in `loadForProject()` |
| `app/components/KanbanCard.vue` | Add conditional cost footer |

## Future Extensions

This design creates a foundation for:
- **Cost dashboard:** aggregate persisted data across cards/columns/projects
- **Budget alerts:** compare accumulated project cost against a threshold
- **Cost event log:** a separate `cost_events` table for per-query granularity and time-series analysis
- **Cost-aware routing:** display per-model pricing, suggest downgrades

These are explicitly deferred and not part of this spec.
