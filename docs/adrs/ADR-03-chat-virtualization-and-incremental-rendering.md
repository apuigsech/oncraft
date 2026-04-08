# ADR-03: Chat virtualization and incremental rendering budget

## Status
Accepted

## Context
Long conversations increase DOM size and rendering cost, especially while streaming tokens and switching between tabs/panels.

## Decision
Apply incremental rendering controls and bounded list rendering:
- cap rendered chat history window in `ChatPanel` (tail window with explicit "Load full history");
- keep markdown parsing debounced and lazily loaded;
- add containment hints (`contain`, `content-visibility`) on high-frequency surfaces;
- maintain sticky-scroll ownership in `ChatPanel` with throttled mutation reactions.

## Consequences
- Lower layout/paint work on very long chats.
- Better perceived tab-switch and stream smoothness.
- Trade-off: older messages are hidden by default until user requests full history.
