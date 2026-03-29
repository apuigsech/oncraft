# Agents Activity Panel Visualization — Specification

## Problem Statement

The current `AgentProgressBar` component displays minimal feedback while the agent is working: a pulsating 6px dot and a "Working..." label (or the latest SDK progress message). It provides no insight into elapsed time, token consumption, or sub-agent activity detail. Users lack real-time awareness of what the agent is doing, how long it has been running, and how much it is costing.

## Goals

1. Make the activity panel **informative**: show elapsed time, token usage, and sub-agent breakdown.
2. Make it **adaptive**: compact by default, auto-expand when sub-agents are active.
3. Make it **visually polished**: subtle/integrated style that blends with the chat UI without competing for attention.
4. Allow **manual control**: click to force expand or collapse.

## Design Decisions (from brainstorming)

| Aspect | Decision |
|--------|----------|
| Detail level | Adaptive — compact by default, expands when sub-agents are present |
| Compact info | Current tool name + elapsed time + tokens consumed (current query) |
| Expanded info | Sub-agent list with description + individual elapsed time |
| Visual style | Subtle/integrated — same background tones as chat, tenue borders |
| Transitions | Smooth 200ms ease expand/collapse, fade-in for sub-agents |
| Interactivity | Click to manually toggle expand/collapse |

## Requirements

### R1: Compact Mode (no sub-agents)

**R1.1** — Display a pulsating LED indicator (existing behavior, keep as-is).

**R1.2** — Show the current tool name with its corresponding icon. Use the existing `subtypeIcon` map for tool-type icons. When no specific tool is active but the agent is working, show a generic working indicator.

**R1.3** — Show elapsed time since the current query started (not since the tool started). Format: `Xs` for under 60s, `Xm Ys` for 60s+. Update every second.

**R1.4** — Show tokens consumed in the current query. Format: `X.Xk tokens` for 1000+, `X tokens` for under 1000. Updated as token data arrives from the sidecar.

**R1.5** — Show a chevron indicator (▾/▴) on the right edge as an affordance for manual expand/collapse.

**R1.6** — Layout: single row, flex, items centered. Order: LED → icon → tool name → `·` → time → `·` → tokens → chevron.

### R2: Expanded Mode (sub-agents active)

**R2.1** — Auto-expand when `getActiveSubAgentCount(cardId) > 0`. The main row (R1) remains at the top.

**R2.2** — Below the main row, show a list of active sub-agents. Each sub-agent row displays:
- A smaller pulsating LED (4px, green `#9ece6a`)
- The sub-agent description (from `task_started.description`)
- Its individual elapsed time since `task_started` (right-aligned)

**R2.3** — Sub-agent rows are connected visually with a left border line (1px solid `--bg-tertiary`) with left padding, creating a tree-like hierarchy.

**R2.4** — When a sub-agent completes (`task_notification`), remove it from the list. If the list becomes empty, auto-collapse back to compact mode.

### R3: Manual Expand/Collapse

**R3.1** — Clicking anywhere on the panel toggles between compact and expanded views.

**R3.2** — Manual state overrides the auto-expand behavior: if the user collapses while sub-agents are active, it stays collapsed. If the user expands when no sub-agents are present, it stays expanded (showing only the main row).

**R3.3** — The manual override resets when the query completes (panel hides) and a new query begins.

### R4: Transitions and Animation

**R4.1** — Expand/collapse transitions use CSS `max-height` (or equivalent) with `200ms ease` timing.

**R4.2** — New sub-agent rows appear with a fade-in animation (opacity 0→1, 150ms).

**R4.3** — The LED pulse animation continues unchanged (existing 1.2s ease-in-out infinite).

### R5: Long-Running Tool Warning

**R5.1** — When the elapsed time for the current tool exceeds 30 seconds, the LED color changes from accent blue (`#7aa2f7`) to warning yellow (`#e0af68`).

**R5.2** — The time text also changes to the warning color to draw attention.

**R5.3** — When a new tool starts (elapsed resets), colors revert to default.

### R6: Done State

**R6.1** — When a query completes (`result` message), briefly show a "Done" state before hiding: LED turns gray, text shows "Done", time shows total query duration, tokens show final count.

**R6.2** — The done state is visible for 2 seconds, then the panel hides with a fade-out.

### R7: Token Tracking

**R7.1** — Track tokens consumed per query. The counter starts at 0 when `send()` is called and accumulates as streaming tokens arrive.

**R7.2** — Token count source: use the existing `StreamMessage` data. The sidecar already emits token usage in `result` messages. For real-time tracking during streaming, count output tokens from assistant streaming chunks. Input tokens can be estimated or shown only at query completion.

**R7.3** — If real-time token data is not available from the sidecar during streaming, show the token counter only after it becomes available (e.g., from `result.usage`), or estimate from streamed character count.

### R8: Visibility

**R8.1** — The panel is visible only when `isActive` is true (existing behavior) OR during the 2-second "Done" fade-out (R6).

**R8.2** — When not visible, the panel occupies zero height (existing `min-height: 0` on `.progress-area`).

## Constraints

- **No sidecar changes**: All data needed (tool names, sub-agent events, timing) is already available from the SDK messages that reach the frontend. Token tracking may need minor additions to track per-query accumulation in the sessions store.
- **No new dependencies**: Use only CSS animations and existing Vue reactivity. No animation libraries.
- **Performance**: Timers (1-second interval for elapsed time) must be cleaned up when the panel hides. Token counter updates should not trigger excessive re-renders — use the existing `requestAnimationFrame` buffering pattern if needed.
- **Existing CSS variables**: Use only the existing theme variables (`--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--border`, `--accent`, `--text-primary`, `--text-secondary`, `--text-muted`, `--warning`).

## Out of Scope

- **Accumulated session token totals** — only current query tokens are shown. Session totals remain in `SessionMetrics`.
- **Cost estimation in dollars** — not included in this iteration.
- **Tool history/trail** — no breadcrumb of past tools. This info is already visible in the chat inline messages.
- **Per-tool elapsed time** — the timer shows query-level time, not individual tool duration (except sub-agents which have their own timer from `task_started`).
- **Click for detailed popover** — only expand/collapse, no popovers or tooltips.
- **Changes to KanbanCard's StatusIndicator** — that component is separate and unchanged.
- **Console mode** — this panel only applies to the integrated chat mode (`ChatPanel`).

## Affected Components

| Component/File | Change |
|----------------|--------|
| `app/components/AgentProgressBar.vue` | Complete rewrite — new layout, timers, token display, expand/collapse |
| `app/stores/sessions.ts` | Add per-query token accumulator and query start timestamp tracking |
| `app/composables/useChatParts.ts` | Possibly expose additional computed data (query start time) |
| `app/types/index.ts` | Add types if needed for timer/token state |

## Acceptance Criteria

- [ ] **AC1**: When the agent starts working, the panel shows: pulsating LED + current tool icon/name + elapsed time counting up + token count.
- [ ] **AC2**: When sub-agents spawn, the panel auto-expands to show each sub-agent with description and individual timer.
- [ ] **AC3**: When all sub-agents complete, the panel auto-collapses to compact mode.
- [ ] **AC4**: Clicking the panel toggles expand/collapse manually.
- [ ] **AC5**: Manual collapse persists even if sub-agents are active (until next query).
- [ ] **AC6**: After 30s on the same tool, LED and time turn yellow (warning color).
- [ ] **AC7**: When query completes, panel shows "Done" state for 2s, then fades out.
- [ ] **AC8**: All transitions are smooth (200ms ease for expand, 150ms fade for sub-agents, fade-out for done state).
- [ ] **AC9**: No visible performance degradation — timers clean up, token updates are batched.
- [ ] **AC10**: Panel uses existing CSS variables and blends visually with the chat UI.
