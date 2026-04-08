# ADR-01: Sessions split into transport/model/projection layers

## Status
Accepted

## Context
The `sessions` store handled stream ingestion, session lifecycle, and UI projection logic in one reactive surface. This caused expensive recomputations during streaming and made cleanup paths fragile.

## Decision
Introduce stricter boundaries in the current implementation direction:
- transport responsibility stays in `claude-process` (spawn/write/interrupt/kill, utility sidecar requests);
- model responsibility stays in `sessions` state maps (`messages`, metrics, configs, query tracking);
- projection is consumed by dedicated composables/components (`useChatParts`, `useUIMessages`, progress components).

As part of this optimization pass:
- text and thinking streams are buffered through rAF-based flush paths;
- cross-project activity checks are memoized through a computed active-project set;
- shutdown is centralized via `shutdownAllSessions()`.

## Consequences
- Lower reactive churn during token-heavy streams.
- Better isolation of process lifecycle from UI rendering concerns.
- Clearer extension point for future extraction of a dedicated projection cache.
