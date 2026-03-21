# Persistent Cost Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist session cost metrics in SQLite and display them on Kanban cards and the ChatPanel header so they survive app restarts.

**Architecture:** Add four columns to the existing `cards` table (cost_usd, input_tokens, output_tokens, duration_ms). Fix the token accumulation bug in the sessions store. Wire up a debounced persist path from handleMeta through the cards store to SQLite. Initialize sessionMetrics from DB when opening a chat. Add a subtle cost footer to KanbanCard.

**Tech Stack:** TypeScript, Vue 3, Pinia, SQLite via @tauri-apps/plugin-sql, Nuxt 4

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `app/types/index.ts` | Modify (line 12-30) | Add 4 optional cost fields to `Card` interface |
| `app/services/database.ts` | Modify (lines 13-56, 91-110, 123-135) | Add schema migration, extend row mapping and UPDATE SQL |
| `app/stores/sessions.ts` | Modify (lines 51-56, 107-125, 299-330) | Fix token accumulation, persist after handleMeta, init from DB on chat open |
| `app/stores/cards.ts` | Modify (lines 46-49, 159-163) | Add `updateCardMetrics()`, expose in return, map cost fields in loadForProject |
| `app/components/KanbanCard.vue` | Modify (lines 119-137) | Add conditional cost footer |

---

### Task 1: Add cost fields to Card type

**Files:**
- Modify: `app/types/index.ts:12-30`

- [ ] **Step 1: Add cost fields to the Card interface**

In `app/types/index.ts`, add four optional fields after `worktreeName` (line 27), before `linkedFiles`:

```typescript
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
```

The full interface should look like:

```typescript
export interface Card {
  id: string;
  projectId: string;
  name: string;
  description: string;
  columnName: string;
  columnOrder: number;
  sessionId: string;
  consoleSessionId?: string;
  state: CardState;
  tags: string[];
  createdAt: string;
  lastActivityAt: string;
  archived: boolean;
  useWorktree?: boolean;
  worktreeName?: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  linkedFiles?: Record<string, string>;
  linkedIssues?: CardLinkedIssue[];
}
```

- [ ] **Step 2: Verify no type errors**

Run: `cd /Users/albert.puigsech/Develop/github.com/apuigsech/oncraft/.claude/worktrees/persistent-cost-dashboard && pnpm nuxi typecheck`

Expected: No new errors (these are optional fields so nothing breaks).

- [ ] **Step 3: Commit**

```bash
git add app/types/index.ts
git commit -m "$(cat <<'EOF'
feat: add cost metric fields to Card interface

Add optional costUsd, inputTokens, outputTokens, durationMs fields
to the Card type for persistent cost tracking.
EOF
)"
```

---

### Task 2: Schema migration and database layer

**Files:**
- Modify: `app/services/database.ts:13-56` (migrations)
- Modify: `app/services/database.ts:91-110` (getCardsByProject row mapping)
- Modify: `app/services/database.ts:123-135` (updateCard SQL)

- [ ] **Step 1: Add schema migration for cost columns**

In `app/services/database.ts`, append these migrations after the `console_session_id` migration (after line 55):

```typescript
  // Migration: add cost tracking columns if missing (for existing DBs)
  try {
    await db.execute('ALTER TABLE cards ADD COLUMN cost_usd REAL DEFAULT 0');
  } catch { /* column already exists */ }
  try {
    await db.execute('ALTER TABLE cards ADD COLUMN input_tokens INTEGER DEFAULT 0');
  } catch { /* column already exists */ }
  try {
    await db.execute('ALTER TABLE cards ADD COLUMN output_tokens INTEGER DEFAULT 0');
  } catch { /* column already exists */ }
  try {
    await db.execute('ALTER TABLE cards ADD COLUMN duration_ms INTEGER DEFAULT 0');
  } catch { /* column already exists */ }
```

- [ ] **Step 2: Extend getCardsByProject row type and mapping**

In `app/services/database.ts`, update the `getCardsByProject` function. Add cost fields to the `select` type annotation (line 93-98):

```typescript
  const rows = await d.select<Array<{
    id: string; project_id: string; name: string; description: string;
    column_name: string; column_order: number; session_id: string;
    console_session_id: string;
    state: string; tags: string; created_at: string; last_activity_at: string;
    archived: number; use_worktree: number; worktree_name: string;
    cost_usd: number; input_tokens: number; output_tokens: number; duration_ms: number;
  }>>('SELECT * FROM cards WHERE project_id = $1 ORDER BY column_order ASC', [projectId]);
```

And add mappings in the `rows.map` block (after line 108):

```typescript
    costUsd: r.cost_usd || 0,
    inputTokens: r.input_tokens || 0,
    outputTokens: r.output_tokens || 0,
    durationMs: r.duration_ms || 0,
```

The full return should be:

```typescript
  return rows.map(r => ({
    id: r.id, projectId: r.project_id, name: r.name, description: r.description,
    columnName: r.column_name, columnOrder: r.column_order, sessionId: r.session_id,
    consoleSessionId: r.console_session_id || undefined,
    state: r.state as Card['state'], tags: JSON.parse(r.tags),
    createdAt: r.created_at, lastActivityAt: r.last_activity_at,
    archived: r.archived === 1,
    useWorktree: r.use_worktree === 1,
    worktreeName: r.worktree_name || undefined,
    costUsd: r.cost_usd || 0,
    inputTokens: r.input_tokens || 0,
    outputTokens: r.output_tokens || 0,
    durationMs: r.duration_ms || 0,
  }));
```

- [ ] **Step 3: Extend updateCard SQL to include cost columns**

In `app/services/database.ts`, update the `updateCard` function (line 123-135). Add cost columns to the UPDATE SET clause and parameter list:

```typescript
export async function updateCard(card: Card): Promise<void> {
  const d = await getDb();
  await d.execute(
    `UPDATE cards SET name=$1, description=$2, column_name=$3, column_order=$4,
     session_id=$5, state=$6, tags=$7, last_activity_at=$8, archived=$9,
     use_worktree=$10, worktree_name=$11, console_session_id=$12,
     cost_usd=$13, input_tokens=$14, output_tokens=$15, duration_ms=$16 WHERE id=$17`,
    [card.name, card.description, card.columnName, card.columnOrder,
     card.sessionId, card.state, JSON.stringify(card.tags),
     card.lastActivityAt, card.archived ? 1 : 0,
     card.useWorktree ? 1 : 0, card.worktreeName || '',
     card.consoleSessionId || '',
     card.costUsd || 0, card.inputTokens || 0, card.outputTokens || 0, card.durationMs || 0,
     card.id]
  );
}
```

- [ ] **Step 4: Verify no type errors**

Run: `cd /Users/albert.puigsech/Develop/github.com/apuigsech/oncraft/.claude/worktrees/persistent-cost-dashboard && pnpm nuxi typecheck`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add app/services/database.ts
git commit -m "$(cat <<'EOF'
feat: add cost columns to cards table with migration

Add cost_usd, input_tokens, output_tokens, duration_ms columns via
ALTER TABLE migrations. Extend getCardsByProject row mapping and
updateCard SQL to include the new cost fields.
EOF
)"
```

---

### Task 3: Fix token accumulation bug and add persist call

**Files:**
- Modify: `app/stores/sessions.ts:107-125` (handleMeta — fix tokens, add persist)
- Modify: `app/stores/sessions.ts:51-56` (getSessionMetrics — init from card)
- Modify: `app/stores/sessions.ts:299-330` (openChat — seed metrics from DB)

- [ ] **Step 1: Fix token accumulation in handleMeta**

In `app/stores/sessions.ts`, inside `handleMeta` (lines 118-121), change token assignment from replacement to accumulation and add the persist call:

```typescript
    // result: extract metrics, capture sessionId, mark query complete, update card state
    if (msg.type === 'result') {
      if (msg.sessionId) {
        cardsStore.updateCardSessionId(cardId, msg.sessionId as string);
      }
      const m = getSessionMetrics(cardId);
      if (msg.costUsd) m.costUsd += msg.costUsd as number;
      if (msg.durationMs) m.durationMs += msg.durationMs as number;
      if (msg.usage) {
        const usage = msg.usage as { inputTokens?: number; outputTokens?: number };
        m.inputTokens += usage.inputTokens || 0;
        m.outputTokens += usage.outputTokens || 0;
      }
      // Persist accumulated metrics to SQLite via cards store
      cardsStore.updateCardMetrics(cardId, {
        costUsd: m.costUsd,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        durationMs: m.durationMs,
      });
      markQueryComplete(cardId);
      cardsStore.updateCardState(cardId, 'idle');
      return;
    }
```

The key changes are:
1. Lines `m.inputTokens = usage.inputTokens || m.inputTokens` → `m.inputTokens += usage.inputTokens || 0` (same for outputTokens)
2. Added `cardsStore.updateCardMetrics(...)` call after accumulation

- [ ] **Step 2: Seed sessionMetrics from Card on chat open**

In `app/stores/sessions.ts`, inside the `openChat` function (around line 299), add metric seeding from the Card object right after `activeChatCardId.value = cardId`:

```typescript
  async function openChat(cardId: string): Promise<void> {
    activeChatCardId.value = cardId;

    // Seed session metrics from persisted card data (survives app restart)
    const cardsStore = useCardsStore();
    const card = cardsStore.cards.find(c => c.id === cardId);
    if (card && !sessionMetrics[cardId]) {
      sessionMetrics[cardId] = {
        costUsd: card.costUsd || 0,
        inputTokens: card.inputTokens || 0,
        outputTokens: card.outputTokens || 0,
        durationMs: card.durationMs || 0,
      };
    }

    // ME-5: Eagerly init markdown engine when chat opens (lazy-loaded deps)
    ensureMarkdownReady();
```

This ensures that when opening a chat, `SessionMetrics.vue` in the ChatPanel header immediately shows persisted values.

- [ ] **Step 3: Verify no type errors**

Run: `cd /Users/albert.puigsech/Develop/github.com/apuigsech/oncraft/.claude/worktrees/persistent-cost-dashboard && pnpm nuxi typecheck`

Expected: Will fail because `cardsStore.updateCardMetrics` doesn't exist yet. That's expected — it's implemented in Task 4.

- [ ] **Step 4: Commit**

```bash
git add app/stores/sessions.ts
git commit -m "$(cat <<'EOF'
fix: accumulate tokens correctly and persist metrics to SQLite

Change token assignment from replacement (=) to accumulation (+=) in
handleMeta. Add persist call to cardsStore.updateCardMetrics after each
result message. Seed sessionMetrics from persisted Card data on chat open.
EOF
)"
```

---

### Task 4: Add updateCardMetrics to cards store

**Files:**
- Modify: `app/stores/cards.ts:94-101` (add updateCardMetrics after updateCardConsoleSessionId)
- Modify: `app/stores/cards.ts:159-163` (expose in return object)

- [ ] **Step 1: Add updateCardMetrics function**

In `app/stores/cards.ts`, add this function after `updateCardConsoleSessionId` (after line 101):

```typescript
  function updateCardMetrics(cardId: string, metrics: { costUsd: number; inputTokens: number; outputTokens: number; durationMs: number }): void {
    const card = cards.value.find(c => c.id === cardId);
    if (!card) return;
    card.costUsd = metrics.costUsd;
    card.inputTokens = metrics.inputTokens;
    card.outputTokens = metrics.outputTokens;
    card.durationMs = metrics.durationMs;
    _debouncedDbWrite(card);
  }
```

- [ ] **Step 2: Expose updateCardMetrics in the return object**

In `app/stores/cards.ts`, add `updateCardMetrics` to the return object (line 160):

```typescript
  return {
    cards, loadedProjectId, cardsByColumn, loadForProject,
    addCard, moveCard, updateCardState, updateCardSessionId, updateCardConsoleSessionId,
    updateCardMetrics, updateCardInfo,
    reorderColumn, applyColumnOrder, archiveCard, unarchiveCard, removeCard,
  };
```

- [ ] **Step 3: Verify no type errors**

Run: `cd /Users/albert.puigsech/Develop/github.com/apuigsech/oncraft/.claude/worktrees/persistent-cost-dashboard && pnpm nuxi typecheck`

Expected: No errors. The `cardsStore.updateCardMetrics` call in sessions.ts now resolves.

- [ ] **Step 4: Commit**

```bash
git add app/stores/cards.ts
git commit -m "$(cat <<'EOF'
feat: add updateCardMetrics with debounced SQLite persist

Add updateCardMetrics to cards store that updates the in-memory Card
object and triggers a debounced write to SQLite, reusing the existing
_debouncedDbWrite path.
EOF
)"
```

---

### Task 5: Add cost footer to KanbanCard

**Files:**
- Modify: `app/components/KanbanCard.vue:96-183`

- [ ] **Step 1: Add formatTokens helper function**

In `app/components/KanbanCard.vue`, add this function in the `<script setup>` section (e.g. after the `timeAgo` function, around line 54):

```typescript
function formatTokens(n: number): string {
  if (!n || n < 1000) return String(n || 0);
  return `${(n / 1000).toFixed(1)}k`;
}
```

- [ ] **Step 2: Add cost footer to template**

In `app/components/KanbanCard.vue`, add a cost metrics row between the existing `card-footer` div (line 137) and the closing `</div>` of `card-inner` (line 138). Insert after line 137 (after `</div>` of card-footer):

```html
      <div v-if="card.costUsd && card.costUsd > 0" class="card-cost-footer">
        <span class="cost-amount">${{ card.costUsd.toFixed(4) }}</span>
        <span class="cost-tokens">↑{{ formatTokens(card.inputTokens) }} ↓{{ formatTokens(card.outputTokens) }}</span>
      </div>
```

- [ ] **Step 3: Add styles for cost footer**

In `app/components/KanbanCard.vue`, add these styles at the end of the `<style scoped>` section (before the closing `</style>`):

```css
.card-cost-footer {
  display: flex;
  gap: 8px;
  padding-top: 6px;
  margin-top: 6px;
  border-top: 1px solid var(--bg-tertiary);
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 10px;
  color: var(--text-muted);
}
.cost-amount { white-space: nowrap; }
.cost-tokens { white-space: nowrap; }
```

- [ ] **Step 4: Verify the app builds**

Run: `cd /Users/albert.puigsech/Develop/github.com/apuigsech/oncraft/.claude/worktrees/persistent-cost-dashboard && pnpm build`

Expected: Build completes without errors.

- [ ] **Step 5: Commit**

```bash
git add app/components/KanbanCard.vue
git commit -m "$(cat <<'EOF'
feat: show cost metrics footer on Kanban cards

Add a subtle monospace footer to KanbanCard showing accumulated cost
and token usage. Only visible when costUsd > 0.
EOF
)"
```

---

### Task 6: Manual verification

- [ ] **Step 1: Run the full app**

Run: `cd /Users/albert.puigsech/Develop/github.com/apuigsech/oncraft/.claude/worktrees/persistent-cost-dashboard && pnpm tauri dev`

- [ ] **Step 2: Verify cost display on cards**

1. Open a project with an existing card
2. Send a message to a card
3. Wait for the response to complete
4. Verify the card shows cost footer: `$X.XXXX ↑Xk ↓Xk`
5. Verify the ChatPanel header shows the same metrics

- [ ] **Step 3: Verify persistence**

1. Note the cost values shown on a card
2. Close the app completely
3. Reopen the app
4. Verify the same card still shows the cost footer with the same values
5. Open the chat panel — verify SessionMetrics shows the persisted values

- [ ] **Step 4: Verify accumulation**

1. Send another message to the same card
2. Verify cost increases (not resets)
3. Verify tokens increase (not replace)
