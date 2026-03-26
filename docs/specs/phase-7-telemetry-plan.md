# Phase 7 — Telemetry: Implementation Plan

**Parent spec:** `docs/specs/product-ready-spec.md` (section 2.8)
**Parent plan:** `docs/specs/product-ready-plan.md` (Phase 7)
**Requirements:** REQ-TEL-L1 through REQ-TEL-L3, REQ-TEL-R1 through REQ-TEL-R5
**Date:** 2026-03-26

---

## Current State Assessment

### Already implemented (by prior phases)

| Asset | State |
|-------|-------|
| `database.ts` — metric columns (`cost_usd`, `input_tokens`, `output_tokens`, `duration_ms`) | Exist in `cards` table |
| `database.ts` — `getUsageMetrics()` aggregation query (today/week/month costs, tokens, session count) | Exists and works |
| `database.ts` — `getProjectCardSummaries()`, `getActiveCardsAllProjects()` | Exist |
| `sessions.ts` — `handleMeta()` accumulates metrics from sidecar `result` messages | Works, calls `cardsStore.updateCardMetrics()` |
| `types/index.ts` — `GlobalSettings.telemetryEnabled` field | Exists (optional boolean) |
| `types/index.ts` — `GlobalSettings.onboardingCompleted`, `onboardingDismissed` | Exist |
| `settings.ts` — `DEFAULT_SETTINGS` with `defaultModel`, `defaultEffort` | Present |
| `GlobalSettingsPage.vue` — Full telemetry section (toggle, "What we collect", disabled "View Telemetry Data" button) | Exists, toggle wired to `settings.telemetryEnabled` |
| `HomeScreen.vue` — Usage metrics block (Block 3) calling `getUsageMetrics()` | Exists and renders real data |
| `OnboardingWizard.vue` — Telemetry opt-in checkbox that saves to `settings.telemetryEnabled` | Exists (native checkbox, saves on nextStep/finish) |
| `error-handler.ts` — `dispatchToTelemetry()` stub with Phase 7 comment markers | Exists as no-op |

### Still needed

| Asset | Gap |
|-------|-----|
| `app/services/telemetry.ts` | Does not exist — entire service must be created |
| `types/index.ts` — `telemetryInstallId` field | Missing from `GlobalSettings` |
| `settings.ts` — `telemetryInstallId` default | Missing |
| `database.ts` — per-project cost aggregation query | Missing (global exists, per-project does not) |
| `GlobalSettingsPage.vue` — "View Telemetry Data" wired to real data | Button is `disabled`, shows placeholder text |
| `OnboardingWizard.vue` — wire checkbox to telemetry service (init install ID) | Currently only saves boolean to settings |
| `error-handler.ts` — wire `dispatchToTelemetry` to real service | Currently no-op |
| `app.vue` — init telemetry on mount if opted in | No telemetry init logic |

---

## Privacy Rules (REQ-TEL-R2) — Non-Negotiable

**NEVER collect:**
- Project names, paths, or file contents
- Card names, descriptions, or chat content
- API keys, tokens, or credentials
- IP addresses (strip at collection endpoint)
- Any personally identifiable information

**ONLY collect (when opted in):**
- Anonymous install ID (UUID), app version, OS
- Launch frequency, session duration
- Chat mode (integrated/console), worktree usage (yes/no)
- GitHub integration enabled (yes/no), flow preset names
- Model/effort selections
- Sanitized error type + message (no paths, no user data)

---

## Step 7.1 — Local Metrics Infrastructure

**Goal:** Add per-project cost aggregation query to `database.ts`. Verify metrics persistence in `sessions.ts` is complete.

### Files to modify

**`app/services/database.ts`**
- Add `getUsageMetricsByProject(projectId: string): Promise<UsageMetrics>` — same structure as `getUsageMetrics()` but filtered by `project_id`.
- The existing `getUsageMetrics()` global query already covers REQ-TEL-L1 for global aggregates (today/week/month costs, tokens, session count). No changes needed there.

**`app/stores/sessions.ts`**
- Verify `handleMeta()` persists metrics on every `result` message. **Current code already does this** (lines 153-175: accumulates costUsd/durationMs/inputTokens/outputTokens, then calls `cardsStore.updateCardMetrics()`). No code changes needed — just verification.

### Acceptance criteria
- `getUsageMetricsByProject(projectId)` returns accurate cost/token/session data for a single project.
- Global `getUsageMetrics()` continues to work (already passes).
- Metrics persist after session result (already works — verify only).

### Dependencies
- None (standalone)

---

## Step 7.2 — Remote Telemetry Service

**Goal:** Create `app/services/telemetry.ts` — the core telemetry service. Add `telemetryInstallId` to settings.

### Files to create

**`app/services/telemetry.ts`**
New service with the following responsibilities:

1. **Install ID management:**
   - `getOrCreateInstallId()`: Reads `telemetryInstallId` from settings. If empty, generates UUID v4 via `crypto.randomUUID()`, saves to settings, returns it.
   - Install ID is created on first opt-in (not on app install).

2. **Opt-in state:**
   - `isEnabled()`: Reads `settings.telemetryEnabled`.
   - `setEnabled(enabled: boolean)`: Updates setting, if turning on for first time creates install ID, if turning off clears event queue.

3. **Event types (TypeScript union):**
   - `TelemetryEvent = AdoptionEvent | FeatureUsageEvent | ErrorEvent`
   - `AdoptionEvent`: `{ type: 'adoption', action: 'launch' | 'session_start' | 'session_end', installId, appVersion, os, timestamp }`
   - `FeatureUsageEvent`: `{ type: 'feature', feature: string, value: string | boolean | number, installId, appVersion, timestamp }`
   - `ErrorEvent`: `{ type: 'error', errorType: string, message: string, context: string, installId, appVersion, timestamp }`

4. **Sanitization:**
   - `sanitizeErrorMessage(msg: string): string` — strips file paths (regex: `/\/[\w\-./]+/g` → `<path>`), strips anything resembling API keys (`/sk-[a-zA-Z0-9]+/g` → `<key>`), truncates to 200 chars.
   - `sanitizeStackTrace(stack: string): string` — keeps only function names and line numbers, strips file paths.

5. **Event queue:**
   - In-memory array `eventQueue: TelemetryEvent[]`.
   - `track(event: TelemetryEvent)`: If opted in, adds to queue. If queue > 100, drop oldest.
   - `flush()`: POST queue to endpoint (placeholder URL: `https://telemetry.oncraft.dev/v1/events`). On success, clear queue. On failure (offline, error), keep in queue for next flush.
   - Queue is **not** persisted to disk in this first implementation. Lost on app close.

6. **Convenience methods:**
   - `trackLaunch()`: Tracks adoption launch event.
   - `trackSessionStart()`: Tracks session start.
   - `trackSessionEnd(durationMs: number)`: Tracks session end with duration.
   - `trackFeature(feature: string, value: string | boolean | number)`: Tracks feature usage.
   - `trackError(error: unknown, context: string)`: Sanitizes and tracks error.

7. **Init/lifecycle:**
   - `initTelemetry()`: Called on app mount. If enabled, ensures install ID exists, tracks launch event. Sets up periodic flush (every 5 minutes via `setInterval`).
   - `shutdownTelemetry()`: Flushes remaining events. Called on app unmount.

### Files to modify

**`app/types/index.ts`**
- Add `telemetryInstallId?: string` to `GlobalSettings` interface.

**`app/stores/settings.ts`**
- No code changes needed — the existing `{ ...DEFAULT_SETTINGS, ...raw }` merge already handles new optional fields gracefully.

### Acceptance criteria
- When opted in: `trackLaunch()` creates an event in the queue with install ID, version, OS.
- When opted out: `track()` is a no-op, queue stays empty.
- `sanitizeErrorMessage()` strips paths and keys from error messages.
- Install ID is UUID format, generated once and persisted.
- Queue caps at 100 events (FIFO drop).
- `flush()` attempts HTTP POST (expected to fail silently in dev since endpoint doesn't exist yet).

### Dependencies
- None (standalone, but uses settings store)

---

## Step 7.3 — Wire Telemetry to Settings & Home

**Goal:** Connect GlobalSettingsPage telemetry toggle to real service. Enable "View Telemetry Data" button. Wire HomeScreen usage metrics to real DB queries (already done — verify).

### Files to modify

**`app/components/GlobalSettingsPage.vue`**
- Import telemetry service.
- Wire the `telemetryEnabled` computed setter to also call `telemetry.setEnabled(val)` — so toggling on creates install ID and toggling off clears queue.
- Enable the "View Telemetry Data" button (remove `disabled`). On click, show a `UModal` with the current `eventQueue` contents as formatted JSON.
- Show install ID in telemetry section (masked: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` unless "Show" is clicked).

**`app/components/HomeScreen.vue`**
- **Already wired** to `getUsageMetrics()` from `database.ts`. The Block 3 usage metrics display real aggregated data. **No changes needed** — verify only.

### Acceptance criteria
- Toggling telemetry on in Settings creates install ID and starts collecting.
- Toggling off stops collection and clears queue.
- "View Telemetry Data" opens a modal showing queued events (or "No events collected" if empty/off).
- Home screen continues to show real usage metrics (no regression).

### Dependencies
- Step 7.2 (telemetry service must exist)

---

## Step 7.4 — Wire Telemetry to Onboarding & Error Handler

**Goal:** Connect OnboardingWizard checkbox to telemetry service. Wire error-handler plugin to dispatch errors. Init telemetry on app mount.

### Files to modify

**`app/components/OnboardingWizard.vue`**
- Import telemetry service.
- In `nextStep()` (when moving from step 0): if telemetry was checked, call `telemetry.setEnabled(true)` which creates the install ID.
- In `finish()`: if `telemetryChecked`, call `telemetry.setEnabled(true)`.
- This replaces the current behavior of only setting `settings.telemetryEnabled` boolean — the telemetry service now handles that internally.

**`app/plugins/error-handler.ts`**
- Import `trackError` from telemetry service.
- Replace the no-op `dispatchToTelemetry` with:
  ```typescript
  const dispatchToTelemetry = (error: unknown, context?: string) => {
    trackError(error, context || 'unknown')
  }
  ```
- `trackError` internally checks opt-in state, so no guard needed here.

**`app/app.vue`**
- Import `initTelemetry` from telemetry service.
- In `onMounted`, after settings load completes, call `initTelemetry()`.
- This tracks the launch event and starts the periodic flush timer.

### Acceptance criteria
- Opting in during onboarding activates telemetry immediately (install ID created, launch tracked).
- Errors caught by error-handler are dispatched to telemetry when opted in.
- Errors are NOT dispatched when opted out.
- App mount initializes telemetry (launch event + flush timer).
- Error messages are sanitized (no paths, no keys, no PII).

### Dependencies
- Step 7.2 (telemetry service must exist)
- Step 7.3 (settings integration, so both onboarding and settings paths are consistent)

---

## Execution Order

```
Step 7.1 (local metrics)  ─┐
                            ├── can run in parallel
Step 7.2 (telemetry.ts)   ─┘
            │
            ▼
Step 7.3 (wire settings + home)
            │
            ▼
Step 7.4 (wire onboarding + errors + app mount)
```

Each step gets its own commit.

---

## File Change Summary

| File | Step | Action |
|------|------|--------|
| `app/services/database.ts` | 7.1 | Add `getUsageMetricsByProject()` |
| `app/stores/sessions.ts` | 7.1 | Verify only (no changes expected) |
| `app/services/telemetry.ts` | 7.2 | **Create** — full telemetry service |
| `app/types/index.ts` | 7.2 | Add `telemetryInstallId` to `GlobalSettings` |
| `app/components/GlobalSettingsPage.vue` | 7.3 | Wire toggle to service, enable "View Data" modal |
| `app/components/HomeScreen.vue` | 7.3 | Verify only (already wired) |
| `app/components/OnboardingWizard.vue` | 7.4 | Wire checkbox to `telemetry.setEnabled()` |
| `app/plugins/error-handler.ts` | 7.4 | Replace no-op with `trackError()` |
| `app/app.vue` | 7.4 | Add `initTelemetry()` call on mount |
