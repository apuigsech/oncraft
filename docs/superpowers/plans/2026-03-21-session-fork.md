# Session Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to fork a Kanban card, creating a new card whose Claude session inherits the parent's full conversation history via the SDK's `resume` + `forkSession` option.

**Architecture:** The fork flows bottom-up: data model first (type + DB), then store logic, then sidecar bridge, then UI components. Each layer is independently committable and testable. The SDK already supports `forkSession: true` natively — no SDK changes needed.

**Tech Stack:** Vue 3, Pinia, Tauri shell plugin, SQLite (`@tauri-apps/plugin-sql`), Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), Bun (sidecar compiler)

**Spec:** `docs/superpowers/specs/2026-03-21-session-fork-design.md`

---

### Task 1: Add `forkedFromId` to the Card type

**Files:**
- Modify: `app/types/index.ts:12-34`

- [ ] **Step 1: Add `forkedFromId` field to Card interface**

In `app/types/index.ts`, add `forkedFromId` after line 33 (`linkedIssues`):

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
  forkedFromId?: string;
}
```

- [ ] **Step 2: Verify no type errors**

Run: `pnpm nuxi typecheck` or open the app with `pnpm dev` and check the console for type errors. The new optional field should not break anything.

- [ ] **Step 3: Commit**

```bash
git add app/types/index.ts
git commit -m "feat(types): add forkedFromId field to Card interface"
```

---

### Task 2: Database migration and CRUD for `forked_from_id`

**Files:**
- Modify: `app/services/database.ts:13-76` (migration), `111-142` (getCardsByProject), `144-153` (insertCard), `155-173` (updateCard)

- [ ] **Step 1: Add migration in `runMigrations`**

After the `duration_ms` migration block (line 75), add:

```typescript
  // Migration: add forked_from_id for session forking
  try {
    await db.execute("ALTER TABLE cards ADD COLUMN forked_from_id TEXT DEFAULT ''");
  } catch { /* column already exists */ }
```

- [ ] **Step 2: Update `getCardsByProject` row type and mapping**

In the row type (line 113-121), add `forked_from_id: string;` after `duration_ms: number;`:

```typescript
  const rows = await d.select<Array<{
    id: string; project_id: string; name: string; description: string;
    column_name: string; column_order: number; session_id: string;
    console_session_id: string;
    state: string; tags: string; created_at: string; last_activity_at: string;
    archived: number; use_worktree: number; worktree_name: string;
    linked_files: string; linked_issues: string;
    cost_usd: number; input_tokens: number; output_tokens: number; duration_ms: number;
    forked_from_id: string;
  }>>('SELECT * FROM cards WHERE project_id = $1 ORDER BY column_order ASC', [projectId]);
```

In the return mapping (line 122-141), add after `durationMs` (line 139):

```typescript
      durationMs: r.duration_ms || 0,
      forkedFromId: r.forked_from_id || undefined,
```

- [ ] **Step 3: Update `insertCard` to include `forked_from_id`**

Replace the INSERT at lines 146-152:

```typescript
  await d.execute(
    `INSERT INTO cards (id, project_id, name, description, column_name, column_order, session_id, state, tags, created_at, last_activity_at, use_worktree, worktree_name, forked_from_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [card.id, card.projectId, card.name, card.description, card.columnName,
     card.columnOrder, card.sessionId, card.state, JSON.stringify(card.tags),
     card.createdAt, card.lastActivityAt, card.useWorktree ? 1 : 0, card.worktreeName || '',
     card.forkedFromId || '']
  );
```

- [ ] **Step 4: Update `updateCard` to include `forked_from_id`**

Replace the UPDATE at lines 157-172. Add `forked_from_id=$19` and shift the WHERE `id` to `$20`:

```typescript
  await d.execute(
    `UPDATE cards SET name=$1, description=$2, column_name=$3, column_order=$4,
     session_id=$5, state=$6, tags=$7, last_activity_at=$8, archived=$9,
     use_worktree=$10, worktree_name=$11, console_session_id=$12,
     linked_files=$13, linked_issues=$14,
     cost_usd=$15, input_tokens=$16, output_tokens=$17, duration_ms=$18,
     forked_from_id=$19 WHERE id=$20`,
    [card.name, card.description, card.columnName, card.columnOrder,
     card.sessionId, card.state, JSON.stringify(card.tags),
     card.lastActivityAt, card.archived ? 1 : 0,
     card.useWorktree ? 1 : 0, card.worktreeName || '',
     card.consoleSessionId || '',
     JSON.stringify(card.linkedFiles || {}),
     JSON.stringify(card.linkedIssues || []),
     card.costUsd || 0, card.inputTokens || 0, card.outputTokens || 0, card.durationMs || 0,
     card.forkedFromId || '',
     card.id]
  );
```

- [ ] **Step 5: Verify app starts and loads cards**

Run `pnpm tauri dev`. Open a project. Cards should load without errors. Check the developer console for any SQL errors.

- [ ] **Step 6: Commit**

```bash
git add app/services/database.ts
git commit -m "feat(db): add forked_from_id column with migration and CRUD support"
```

---

### Task 3: Cards store — `addCard` with `forkedFromId`

**Files:**
- Modify: `app/stores/cards.ts:51-68`

- [ ] **Step 1: Add `forkedFromId` parameter to `addCard`**

Replace the `addCard` function signature and body (lines 51-68):

```typescript
  async function addCard(
    projectId: string, columnName: string, name: string, description: string,
    useWorktree?: boolean, forkedFromId?: string,
  ): Promise<Card> {
    const columnCards = cards.value.filter(c => c.columnName === columnName);
    const worktreeName = useWorktree
      ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      : undefined;
    const card: Card = {
      id: uuidv4(), projectId, name, description, columnName,
      columnOrder: columnCards.length, sessionId: '', state: 'idle', tags: [],
      createdAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(), archived: false,
      useWorktree: useWorktree || false,
      worktreeName,
      forkedFromId,
    };
    await db.insertCard(card);
    cards.value.push(card);
    return card;
  }
```

- [ ] **Step 2: Verify no regressions**

Run `pnpm tauri dev`. Create a new card normally (not a fork). It should work identically — `forkedFromId` is undefined and the DB stores empty string.

- [ ] **Step 3: Commit**

```bash
git add app/stores/cards.ts
git commit -m "feat(cards): support forkedFromId parameter in addCard"
```

---

### Task 4: Sidecar — pass `forkSession` through to SDK

**Files:**
- Modify: `app/services/claude-process.ts:76-84,219-235,238-271`
- Modify: `src-sidecar/agent-bridge.ts:641-688`

- [ ] **Step 1: Add `forkSession` parameter to `spawnSession`**

In `app/services/claude-process.ts`, update `spawnSession` signature (line 76-84):

```typescript
export async function spawnSession(
  cardId: string,
  projectPath: string,
  prompt: string,
  sessionId?: string,
  config?: SessionConfig,
  images?: import('~/types').ImageAttachment[],
  columnPrompt?: string,
  forkSession?: boolean,
): Promise<void> {
```

In the start command JSON construction (lines 219-235), add the `forkSession` spread after `columnPrompt`:

```typescript
  const startCmd = JSON.stringify({
    cmd: 'start',
    cardId,
    prompt,
    projectPath,
    ...(sessionId ? { sessionId } : {}),
    ...(config?.model ? { model: config.model } : {}),
    ...(config?.effort ? { effort: config.effort } : {}),
    ...(config?.permissionMode ? { permissionMode: config.permissionMode } : {}),
    ...(config?.worktreeName ? { worktreeName: config.worktreeName } : {}),
    ...(imagePaths?.length ? { imagePaths } : {}),
    ...(columnPrompt ? { columnPrompt } : {}),
    ...(forkSession ? { forkSession: true } : {}),
  });
```

- [ ] **Step 2: Add `forkSession` parameter to `sendStart`**

Same pattern. Update `sendStart` signature (line 238-246):

```typescript
export async function sendStart(
  cardId: string,
  projectPath: string,
  prompt: string,
  sessionId?: string,
  config?: SessionConfig,
  images?: import('~/types').ImageAttachment[],
  columnPrompt?: string,
  forkSession?: boolean,
): Promise<void> {
```

In its start command JSON (lines 257-269), add the spread:

```typescript
  const startCmd = JSON.stringify({
    cmd: 'start',
    cardId,
    prompt,
    projectPath,
    ...(sessionId ? { sessionId } : {}),
    ...(config?.model ? { model: config.model } : {}),
    ...(config?.effort ? { effort: config.effort } : {}),
    ...(config?.permissionMode ? { permissionMode: config.permissionMode } : {}),
    ...(config?.worktreeName ? { worktreeName: config.worktreeName } : {}),
    ...(imagePaths?.length ? { imagePaths } : {}),
    ...(columnPrompt ? { columnPrompt } : {}),
    ...(forkSession ? { forkSession: true } : {}),
  });
```

- [ ] **Step 3: Update `agent-bridge.ts` to read `forkSession` and pass to SDK**

In `src-sidecar/agent-bridge.ts`, the query options block (line 641-688). Add `forkSession` after the `resume` line (line 646):

```typescript
    const queryOptions = {
      pathToClaudeCodeExecutable: cliPath,
      executable: "node",
      env: claudeEnv,
      cwd: projectPath,
      resume: cmd.sessionId ? (cmd.sessionId as string) : undefined,
      forkSession: cmd.forkSession ? true : undefined,
      abortController: abort,
      // ... rest stays the same
```

- [ ] **Step 4: Rebuild sidecar**

Run: `pnpm build:sidecar`

Verify it completes without errors.

- [ ] **Step 5: Commit**

```bash
git add app/services/claude-process.ts src-sidecar/agent-bridge.ts
git commit -m "feat(sidecar): thread forkSession flag from frontend through to SDK"
```

---

### Task 5: Sessions store — fork detection in `send()`

**Files:**
- Modify: `app/stores/sessions.ts:235-237,266-268,282-283`

- [ ] **Step 1: Add fork detection logic after session ID resolution**

In `app/stores/sessions.ts`, replace lines 235-237 with the fork-aware version:

```typescript
    // Determine session ID for resume
    let sessionId = card?.sessionId && !card.sessionId.startsWith('pending-')
      ? card.sessionId : undefined;

    // Fork detection: first message on a forked card with no own session yet
    let forkSession = false;
    if (!sessionId && card?.forkedFromId) {
      const parentCard = cardsStore.cards.find(c => c.id === card.forkedFromId);
      if (parentCard?.sessionId && !parentCard.sessionId.startsWith('pending-')) {
        sessionId = parentCard.sessionId;
        forkSession = true;
      }
    }
```

- [ ] **Step 2: Pass `forkSession` to `sendStart` and `spawnSession`**

Update the two call sites that pass `sessionId`:

Line 268 (existing sidecar reuse path):
```typescript
        await sendStart(cardId, project.path, message, sessionId, config, images, columnPrompt, forkSession);
```

Line 283 (new sidecar spawn path):
```typescript
        await spawnSession(cardId, project.path, message, sessionId, config, images, columnPrompt, forkSession);
```

- [ ] **Step 3: Verify normal (non-fork) sessions still work**

Run `pnpm tauri dev`. Open an existing card. Send a message. Verify it resumes the session normally — the fork detection should be skipped because the card has its own `sessionId`.

- [ ] **Step 4: Commit**

```bash
git add app/stores/sessions.ts
git commit -m "feat(sessions): detect fork scenario and pass forkSession flag to sidecar"
```

---

### Task 6: Context menu — add "Fork" item

**Files:**
- Modify: `app/components/CardContextMenu.vue`

- [ ] **Step 1: Add `fork` to emits and add the button**

Update the emits to include `fork`:

```typescript
const emit = defineEmits<{
  edit: [cardId: string];
  fork: [cardId: string];
  archive: [cardId: string];
  unarchive: [cardId: string];
  delete: [cardId: string];
  close: [];
}>();
```

In the template, add the Fork button between the Edit button and the divider:

```html
      <button class="ctx-item" @click="emit('edit', cardId)">
        <UIcon name="i-lucide-pencil" class="ctx-icon" />
        Edit
      </button>
      <button class="ctx-item" @click="emit('fork', cardId)">
        <UIcon name="i-lucide-git-branch" class="ctx-icon" />
        Fork
      </button>
      <div class="ctx-divider" />
```

- [ ] **Step 2: Verify visually**

Run `pnpm tauri dev`. Right-click a card. The "Fork" option should appear between "Edit" and the divider with the git-branch icon.

- [ ] **Step 3: Commit**

```bash
git add app/components/CardContextMenu.vue
git commit -m "feat(ui): add Fork option to card context menu"
```

---

### Task 7: KanbanCard — relay fork event and show badge

**Files:**
- Modify: `app/components/KanbanCard.vue`

- [ ] **Step 1: Add `fork` emit to KanbanCard**

Add the emit definition. Currently KanbanCard has no `defineEmits` — add one:

```typescript
const emit = defineEmits<{
  fork: [card: Card];
}>();
```

- [ ] **Step 2: Add `handleFork` function**

After `handleEdit` (line 82-85), add:

```typescript
function handleFork() {
  showMenu.value = false;
  emit('fork', props.card);
}
```

- [ ] **Step 3: Wire fork event from CardContextMenu**

In the template, add `@fork="handleFork"` to the `CardContextMenu` component (line 173-177):

```html
    <CardContextMenu
      v-if="showMenu"
      :x="menuX" :y="menuY" :card-id="card.id" :archived="card.archived"
      @edit="handleEdit" @fork="handleFork" @archive="handleArchive" @unarchive="handleUnarchive"
      @delete="handleDelete" @close="showMenu = false"
    />
```

- [ ] **Step 4: Add fork badge in card header**

Add a computed for the parent card name:

```typescript
const parentCardName = computed(() => {
  if (!props.card.forkedFromId) return undefined;
  const parent = cardsStore.cards.find(c => c.id === props.card.forkedFromId);
  return parent?.name;
});
```

In the template, after the WT badge (line 128-134), add the fork badge:

```html
        <UBadge
          v-if="card.forkedFromId"
          variant="soft"
          color="warning"
          size="xs"
          class="fork-badge"
          :title="parentCardName ? 'Forked from ' + parentCardName : 'Fork'"
        >Fork</UBadge>
```

- [ ] **Step 5: Add CSS for fork-badge**

In the `<style scoped>` block, after `.worktree-badge` (line 204):

```css
.fork-badge { flex-shrink: 0; }
```

- [ ] **Step 6: Verify visually**

Run `pnpm tauri dev`. The fork badge won't appear yet (no forked cards exist), but right-clicking a card and clicking "Fork" should close the menu (the event goes up but is not handled by KanbanColumn yet — that's Task 8).

- [ ] **Step 7: Commit**

```bash
git add app/components/KanbanCard.vue
git commit -m "feat(ui): relay fork event from card and show Fork badge"
```

---

### Task 8: NewSessionDialog — accept pre-fill props

**Files:**
- Modify: `app/components/NewSessionDialog.vue`

- [ ] **Step 1: Add optional props for pre-filling**

Replace the current `<script setup>` (lines 1-14):

```typescript
<script setup lang="ts">

const props = defineProps<{
  initialName?: string;
  initialDescription?: string;
}>();

const emit = defineEmits<{ create: [name: string, description: string, useWorktree: boolean]; cancel: [] }>();
const name = ref(props.initialName || '');
const description = ref(props.initialDescription || '');
const useWorktree = ref(false);

function submit() {
  if (!name.value.trim()) return;
  emit('create', name.value.trim(), description.value.trim(), useWorktree.value);
  name.value = '';
  description.value = '';
  useWorktree.value = false;
}
</script>
```

- [ ] **Step 2: Verify normal card creation still works**

Run `pnpm tauri dev`. Click "+" on a column. The dialog should open with empty fields (no initial props). Create a card — should work identically.

- [ ] **Step 3: Commit**

```bash
git add app/components/NewSessionDialog.vue
git commit -m "feat(ui): add initialName/initialDescription props to NewSessionDialog"
```

---

### Task 9: KanbanColumn — handle fork event end-to-end

**Files:**
- Modify: `app/components/KanbanColumn.vue`

- [ ] **Step 1: Add fork state and handler**

In the `<script setup>` block (after line 11), add fork state:

```typescript
const forkParent = ref<Card | null>(null);
```

Add the import for the Card type at the top of the script (it's already imported on line 3).

Add the fork handler function after `createSession` (after line 61):

```typescript
function handleFork(parentCard: Card) {
  forkParent.value = parentCard;
  showNewDialog.value = true;
}

async function createForkedSession(name: string, description: string, useWorktree: boolean) {
  showNewDialog.value = false;
  const parent = forkParent.value;
  forkParent.value = null;
  const project = projectsStore.activeProject;
  if (!project) return;
  const card = await cardsStore.addCard(
    project.id, props.column.name, name, description, useWorktree,
    parent?.id,
  );
  if (useWorktree && card.worktreeName) {
    sessionsStore.updateSessionConfig(card.id, { worktreeName: card.worktreeName });
  }
  sessionsStore.openChat(card.id);
}
```

- [ ] **Step 2: Update the `create` handler on `NewSessionDialog`**

Replace the `NewSessionDialog` usage (line 107) to pass pre-fill props and route the create event:

```html
    <NewSessionDialog
      v-if="showNewDialog"
      :initial-name="forkParent?.name ? forkParent.name + ' (fork)' : undefined"
      :initial-description="forkParent?.description"
      @create="forkParent ? createForkedSession : createSession"
      @cancel="showNewDialog = false; forkParent = null"
    />
```

Vue `@create` with a function reference passes the emitted arguments (`name`, `description`, `useWorktree`) through as positional parameters. Both `createSession` and `createForkedSession` have the same `(name, description, useWorktree)` signature, so this works.

- [ ] **Step 3: Listen for fork events from KanbanCard**

In the template, add `@fork="handleFork"` on each KanbanCard (line 99-105):

```html
      <KanbanCard
        v-for="card in dragCards"
        :key="card.id"
        :card="card"
        :column-color="column.color"
        @fork="handleFork"
      />
```

- [ ] **Step 4: Reset forkParent when dialog closes normally**

Update the existing `createSession` to also reset `forkParent` for safety:

```typescript
async function createSession(name: string, description: string, useWorktree: boolean) {
  showNewDialog.value = false;
  forkParent.value = null;
  const project = projectsStore.activeProject;
  if (!project) return;
  const card = await cardsStore.addCard(project.id, props.column.name, name, description, useWorktree);
  if (useWorktree && card.worktreeName) {
    sessionsStore.updateSessionConfig(card.id, { worktreeName: card.worktreeName });
  }
  sessionsStore.openChat(card.id);
}
```

- [ ] **Step 5: Full end-to-end test**

Run `pnpm tauri dev`.

1. Create a card normally, send a message so it gets a `sessionId`.
2. Right-click that card → "Fork".
3. Dialog opens pre-filled with `"{name} (fork)"` and same description.
4. Edit if desired, create.
5. New card appears in the same column with "Fork" badge.
6. Open the forked card, send a message.
7. Verify the forked session starts with the parent's history (the SDK's init message should return a new sessionId).
8. Send a second message on the fork — should reuse the fork's own session, not the parent's.

- [ ] **Step 6: Commit**

```bash
git add app/components/KanbanColumn.vue
git commit -m "feat(ui): wire fork flow end-to-end in KanbanColumn"
```

---

### Task 10: Rebuild sidecar and final verification

- [ ] **Step 1: Rebuild sidecar binary**

Run: `pnpm build:sidecar`

- [ ] **Step 2: Full app test**

Run: `pnpm tauri dev`

Test the complete fork flow:
1. Open a project, create a card, have a conversation (2-3 messages).
2. Fork it. Verify the dialog pre-fills correctly.
3. Open the fork. The chat should be empty (history loads on first message).
4. Send a message. Verify the response acknowledges the prior conversation context.
5. Verify the parent card is unaffected — open it, send a message, it continues independently.
6. Fork a fork — verify it works.
7. Delete the parent card — verify the fork still functions.

- [ ] **Step 3: Final commit if any adjustments were needed**

```bash
git add -u
git commit -m "feat: session fork — final adjustments"
```
