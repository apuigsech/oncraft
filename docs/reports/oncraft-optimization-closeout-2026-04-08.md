# OnCraft Optimization Closeout (2026-04-08)

## Scope completed

This closeout covers all phases from the optimization master plan:
- baseline instrumentation;
- lifecycle cleanup and shutdown guardrails;
- tab/render and PTY channel isolation;
- streaming/pipeline buffering changes;
- reactivity cascade reductions;
- data/startup optimizations;
- Agent SDK hardening;
- bundle/security tightening;
- ADR publication.

## Implemented changes by area

### Baseline and telemetry
- Added `app/services/perf.ts` and integrated phase timing metrics in app boot, flow loading, DB hot paths, sidecar sends, and stream flushes.

### Lifecycle and cleanup
- Added `flushAllPendingWrites()` in cards store and hooked it into app shutdown.
- Enforced `stopSession()` + `purgeCard()` during archive/remove/close project flows.
- Added global session shutdown (`shutdownAllSessions`) and sidecar process drain helpers.
- Added temp image tracking and TTL cleanup for sidecar image transport.

### Tabs, PTY, and rendering
- PTY events moved from global channels to per-instance channels (`pty-output-{id}`, `pty-exit-{id}`).
- Console panel now subscribes per PTY instance and removes injected style on unmount.
- Chat mutation scroll logic is rAF-throttled and avoids `characterData` observer cost.
- Chat/console side panel is wrapped in `KeepAlive` with bounded cache.

### Streaming and pipeline
- Unified buffered streaming for assistant text and reasoning/thinking streams.
- Reduced message payload overhead by only storing `raw` chat part payloads in dev builds.

### Reactivity reductions
- Memoized `cardsByColumn` via a computed column map.
- Removed deep watchers in core Kanban paths where shallow/reactive signals are enough.
- Consolidated timers with shared global tick composable (`useSharedNow`) for progress UI.
- Optimized project activity indicator lookup through computed active-project set.

### Data and startup
- Added indexes:
  - `cards(session_id)`
  - `cards(last_activity_at)`
  - `cards(project_id, column_name, column_order)`
- Replaced N-update loops with single CASE-based batch updates for column/order operations.
- Added TTL caching for flow loading and agent resolution.
- Parallelized flow state/preset file reads and agent resolution.

### Agent SDK hardening
- Updated sidecar SDK dependency to `@anthropic-ai/claude-agent-sdk` `^0.2.92` (resolved to latest compatible at install time).
- Added SDK `startup()` prewarm.
- Replaced immediate `process.exit()` stop semantics with graceful shutdown path.
- Added session-end hook emission and stronger MCP/tool allowlist composition.
- Added history loading fallback that requests system messages when supported.

### Bundle and security
- Set modern Vite build target (`es2022`) and added DnD library chunk split.
- Lazy-loaded DOMPurify alongside markdown/highlight engine initialization.
- Added containment hints in chat/kanban heavy render surfaces.
- Added bounded chat history window with explicit full-history expansion.
- Tightened Tauri CSP by removing `unsafe-eval`.
- Reduced FS capability surface by removing `fs:default` and redundant `/var/folders/**` write/mkdir entries.

## Validation and evidence

### Static quality gates
- IDE lint diagnostics checked for edited frontend/sidecar files: no new lints reported.

### Runtime verification executed
- Sidecar dependency refresh executed in `src-sidecar` with Bun; lockfile updated.

### Manual/operational checks still recommended
- Re-run the plan baseline scenarios and record before/after numbers for:
  - boot timing,
  - tab switch latency,
  - streaming smoothness,
  - sidecar/PTY process counts after archive/delete/close app.
- Run project tests:
  - `pnpm test`
  - optional: `pnpm build` and `pnpm tauri dev` smoke test.

## Residual risk

- Chat virtualization currently uses a simple tail-window strategy; behavior is intentionally conservative but should be UX-validated with very long sessions.
- New CSP/FS restrictions are tighter but should be smoke-tested against all file workflows (linking, presets, imports, temp attachments).
