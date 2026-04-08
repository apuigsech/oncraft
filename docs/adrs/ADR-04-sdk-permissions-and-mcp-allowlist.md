# ADR-04: Agent SDK permissions and explicit MCP allowlist

## Status
Accepted

## Context
Permission behavior depended mainly on flow prompts and ad-hoc allow/disallow configuration. This made policy intent harder to reason about when MCP servers changed by state.

## Decision
Establish explicit policy composition from flow resolution through sidecar query options:
- flow store augments allowed tools with MCP server prefixes and required OnCraft MCP bridge tools;
- sidecar merges strict allowlists with explicit bridge tool safety defaults;
- sidecar adds session-end hook emission for lifecycle observability;
- sidecar startup prewarm is enabled to reduce first-query latency;
- stop/close paths use graceful shutdown instead of immediate process exit.

## Consequences
- More transparent, reproducible tool access policy across states.
- Improved observability of session termination reason.
- Safer shutdown semantics for pending approvals and active streams.
