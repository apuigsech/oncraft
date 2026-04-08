# ADR-02: Sidecar process manager guardrails

## Status
Accepted

## Context
Card archiving/removal and app shutdown paths could leave sidecar-related state alive longer than needed, with pending approvals, buffered replies, and utility sidecar resources not consistently drained.

## Decision
Adopt best-effort lifecycle guardrails across store and sidecar boundaries:
- card-level operations call `stopSession()` and `purgeCard()` before persistence removal/archive;
- project close drains active card sessions for the project;
- app shutdown path invokes `shutdownAllSessions()` and flushes pending card writes;
- sidecar service exposes `killAllProcesses()` and `shutdownUtilSidecar()` for deterministic teardown;
- temporary image files are tracked and cleaned with TTL + forced cleanup on utility sidecar shutdown.

## Consequences
- Fewer orphaned processes and stale in-memory references on close/archive/delete flows.
- More predictable shutdown behavior under interruption and rapid tab/project transitions.
- Foundation for future pooling/idle reaping without changing frontend API contracts.
