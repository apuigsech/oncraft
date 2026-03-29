# Agents Activity Panel Visualization — Implementation Plan

**Spec**: `.context/agents/spec/agents-activity-panel-visualization.md`

## Overview

The implementation is split into 5 steps, ordered by dependency. Each step produces a working intermediate state — no step leaves the app broken.

## Step 1: Add query-level tracking to the sessions store

**Goal**: Track per-query start timestamp, accumulated output tokens, and sub-agent start timestamps so the UI can display elapsed time and token counts.

**Files to modify**:
- `app/stores/sessions.ts`

**Changes**:

1. Add a `queryTracking` reactive record keyed by cardId:
   ```ts
   const queryTracking: Record<string, {
     startedAt: number;          // Date.now() when query started
     outputTokens: number;       // accumulated output tokens for this query
     subAgentStartTimes: Record<string, number>;  // taskId → Date.now()
   }> = reactive({});
   ```

2. In `send()` — when a new query starts (after `isQueryActive` check passes, before calling `spawnSession`/`sendStart`):
   - Initialize `queryTracking[cardId] = { startedAt: Date.now(), outputTokens: 0, subAgentStartTimes: {} }`.

3. In `appendPart()` — when processing `task_started`:
   - Also record `queryTracking[cardId].subAgentStartTimes[taskId] = Date.now()`.

4. In `appendPart()` — when processing `task_notification`:
   - Also delete `queryTracking[cardId].subAgentStartTimes[taskId]`.

5. In `handleMeta()` — in the streaming delta handler (`msg.type === 'assistant' && msg.subtype === 'streaming'`):
   - Estimate output tokens by counting words/characters in the streaming token and incrementing `queryTracking[cardId].outputTokens`. Use a simple heuristic: ~4 characters per token (common approximation for English text).

6. In `handleMeta()` — when `result` arrives:
   - If `msg.usage` provides actual `outputTokens`, overwrite the estimate with the real value: `queryTracking[cardId].outputTokens = usage.outputTokens`.

7. In `purgeCard()` — clean up `queryTracking[cardId]`.

8. Expose `getQueryTracking(cardId)` getter and add it to the store's return object.

**Depends on**: Nothing (first step).

**Acceptance criteria addressed**: AC1 (data for time + tokens), AC2 (sub-agent start times), AC9 (no reactive overhead — reuses existing paths).

---

## Step 2: Expose query tracking data via useChatParts

**Goal**: Make query tracking data available to the `AgentProgressBar` component without coupling it directly to the store.

**Files to modify**:
- `app/composables/useChatParts.ts`

**Changes**:

1. Add a `queryTracking` computed that reads from the sessions store:
   ```ts
   const queryTracking = computed(() => {
     if (!cardId.value) return null;
     return sessionsStore.getQueryTracking(cardId.value);
   });
   ```

2. Add it to the return object alongside `progressParts`, `isActive`, etc.

**Depends on**: Step 1.

**Acceptance criteria addressed**: AC1 (data flows to component).

---

## Step 3: Rewrite AgentProgressBar — compact mode

**Goal**: Replace the current minimal implementation with the new compact layout showing tool name, elapsed time, and token count.

**Files to modify**:
- `app/components/AgentProgressBar.vue`

**Changes**:

1. **Props**: Keep existing props (`parts`, `isActive`, `cardId`). Add `queryTracking` prop (the object from Step 2).

2. **Elapsed time timer**: Use `setInterval(1000)` to increment a local `elapsedSeconds` ref. Start when `isActive` becomes true, clear when it becomes false. Initialize from `queryTracking.startedAt`. Format as `Xs` or `Xm Ys`.

3. **Token display**: Computed from `queryTracking.outputTokens`. Format as `X tokens` (<1000) or `X.Xk tokens` (>=1000).

4. **Tool name**: Derive from the latest progress part's `kind` or data, keeping the existing `subtypeIcon` map. Add a fallback label `'Working'` when no tool-specific data is available.

5. **Long-running warning (R5)**: Computed `isWarning = elapsedSeconds > 30`. When true, LED and time text use `var(--warning)` color.

6. **Expand/collapse state**:
   - `manualOverride: Ref<boolean | null>` — `null` means "auto", `true`/`false` means "user forced".
   - `isExpanded` computed: if `manualOverride !== null`, use it. Otherwise, `subAgentCount > 0`.
   - `toggleExpand()` function: sets `manualOverride` to the opposite of current `isExpanded`.
   - Reset `manualOverride` to `null` when `isActive` transitions from `true` to `false` (query ends).

7. **Chevron indicator**: Show `▾` when collapsed, `▴` when expanded. Positioned at `margin-left: auto`.

8. **Click handler**: Entire `.agent-progress` div is clickable, calls `toggleExpand()`.

9. **Template (compact)**: Single row:
   ```
   LED · icon · toolName · · · time · · · tokens · chevron
   ```

10. **CSS**: Update existing styles. Keep `--bg-secondary` background, `--bg-tertiary` border, `8px` border-radius, monospace 11px. Add `cursor: pointer`. Warning state adds `color: var(--warning)` to LED and time.

**Depends on**: Step 2.

**Acceptance criteria addressed**: AC1, AC4, AC5, AC6, AC10.

---

## Step 4: Add expanded mode with sub-agent list

**Goal**: Add the expandable sub-agent section below the compact row.

**Files to modify**:
- `app/components/AgentProgressBar.vue` (continue from Step 3)

**Changes**:

1. **Sub-agent data**: Compute a list of active sub-agents from `progressParts`. For each `task_started` part where the taskId is still in `activeSubAgents`, create an entry with:
   - `taskId`
   - `description` (from `task_started.data.description`)
   - `startedAt` (from `queryTracking.subAgentStartTimes[taskId]`)
   - `elapsedSeconds` (computed from `startedAt` using the same 1s interval timer)

2. **Sub-agent row template**: For each sub-agent:
   ```html
   <div class="sub-agent-row">
     <span class="sub-agent-led" />
     <span class="sub-agent-name">{{ description }}</span>
     <span class="sub-agent-time">{{ elapsed }}</span>
   </div>
   ```

3. **Container**: Wrap sub-agent rows in a `<div class="sub-agents-container">` with a `v-show="isExpanded"`. This container has `padding-left: 14px`, `border-left: 1px solid var(--bg-tertiary)`, `margin-left: 3px`.

4. **Sub-agent LED**: 4px circle, `background: #9ece6a`, same pulse animation as main LED.

5. **Sub-agent time**: Right-aligned, `color: var(--text-muted)`, font-size 10px.

6. **Transitions (R4)**:
   - The sub-agents container uses a CSS transition on `max-height` and `opacity` with `200ms ease`.
   - Individual sub-agent rows use a Vue `<TransitionGroup>` with a fade-in animation (opacity 0→1, 150ms).

**Depends on**: Step 3.

**Acceptance criteria addressed**: AC2, AC3, AC8.

---

## Step 5: Done state and fade-out

**Goal**: Show a brief "Done" summary when the query completes, then fade the panel out.

**Files to modify**:
- `app/components/AgentProgressBar.vue` (continue from Step 4)

**Changes**:

1. **Done state tracking**: Add a `doneState` ref:
   ```ts
   const doneState = ref<{ totalTime: number; tokens: number } | null>(null);
   ```

2. **Watch `isActive`**: When it transitions from `true` to `false`:
   - Capture current `elapsedSeconds` and `queryTracking.outputTokens` into `doneState`.
   - Clear the interval timer.
   - Set a `setTimeout(2000)` to set `doneState = null` (which hides the panel).
   - Reset `manualOverride = null`.

3. **Visibility**: Update `visible` computed:
   ```ts
   const visible = computed(() => props.isActive || doneState.value !== null);
   ```

4. **Done template**: When `doneState !== null && !isActive`:
   - LED: gray (`var(--text-muted)`), no animation.
   - Text: "Done"
   - Time: total query duration (from `doneState.totalTime`).
   - Tokens: final count (from `doneState.tokens`).

5. **Fade-out animation**: The entire `.agent-progress` div wraps in a `<Transition name="fade">`. The fade CSS: `opacity 1→0` over `300ms ease`.

6. **Timer cleanup**: Ensure `onUnmounted` clears all intervals and timeouts.

**Depends on**: Step 4.

**Acceptance criteria addressed**: AC7, AC8, AC9.

---

## Step 6: Wire it all together in ChatPanel

**Goal**: Pass the new `queryTracking` data to AgentProgressBar from ChatPanel.

**Files to modify**:
- `app/components/ChatPanel.vue`

**Changes**:

1. Destructure `queryTracking` from `useChatParts()` (added in Step 2).

2. Pass it as a prop to `<AgentProgressBar>`:
   ```html
   <AgentProgressBar
     :parts="progressParts"
     :is-active="isActive"
     :card-id="sessionsStore.activeChatCardId!"
     :query-tracking="queryTracking"
   />
   ```

**Depends on**: Steps 2 and 3 (but can be done alongside Step 3).

**Acceptance criteria addressed**: AC1 (complete data pipeline).

---

## Dependency Graph

```
Step 1 (sessions store)
  └─► Step 2 (useChatParts)
        └─► Step 3 (compact mode) ◄── Step 6 (ChatPanel wiring)
              └─► Step 4 (expanded mode)
                    └─► Step 5 (done state)
```

Steps 1→2→3→4→5 are strictly sequential. Step 6 can be done alongside Step 3.

## Files Summary

| File | Steps | Type of change |
|------|-------|---------------|
| `app/stores/sessions.ts` | 1 | Add queryTracking record, init/update/cleanup logic |
| `app/composables/useChatParts.ts` | 2 | Expose queryTracking computed |
| `app/components/AgentProgressBar.vue` | 3, 4, 5 | Complete rewrite |
| `app/components/ChatPanel.vue` | 6 | Pass new prop |

## Verification

After each step, the app should be fully functional:
- **After Step 1**: No visible change (data layer only). Check `queryTracking` is populated in Vue DevTools.
- **After Steps 2+3+6**: Compact panel shows tool + time + tokens. Click toggles expand (empty sub-agent list).
- **After Step 4**: Sub-agents appear/disappear with animations when present.
- **After Step 5**: "Done" state shows for 2s after query completes, then fades.
