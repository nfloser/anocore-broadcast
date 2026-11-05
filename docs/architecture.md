# Architecture: initial decisions

## Product boundary
AnoCore Broadcast is a standalone product, not a submodule of the gameserver. An observer's CS2 Game State Integration provides a first-party data source without AnoCore. Richer server-side data is provided by optional authenticated adapters.

## Implemented
- Versioned protocol envelope validation in `packages/protocol`.
- CS2 observer GSI HTTP receiver in `adapters/cs2`: loopback binding, required shared secret, bounded JSON body, conservative normalization into `observer.snapshot` events, in-memory sequence and source freshness.
- Deterministic in-memory `observer.snapshot` timeline in `services/engine` with strict source sequence handling, duplicate suppression, gap degradation, bounded history and delayed read cutoff.
- Local composition in `services/engine/src/runtime.js` connects authenticated GSI HTTP POSTs to the timeline and rejects ingestion if the engine cannot commit an event.
- Optional synchronous segmented JSONL journal writes committed events before acknowledging GSI; automatic numbered segment rotation preserves ordered replay and a bounded aggregate size, with source-local sequence recovery after restart.
- Explicit journal **integrity checkpoints** record SHA-256 digests of committed prefixes and verify them on restart. These are not state snapshots or permission to delete event history. The CLI starts this composed runtime. Tests exercise the complete HTTP-to-engine path.
- Automated regression tests for malformed, unauthorized, oversized, disconnected/stale, duplicate, reordered and delayed-input cases.

## Planned
- Type-specific payload schemas, an authenticated read API for approved broadcast operators, and secure runtime lifecycle management.
- Production-grade journal lifecycle: rotation, recovery after partial writes, cross-process locking, bounded memory, and resilience to disk failures. The initial single-process write-ahead journal is optional and experimental.
- Broadcast clock alignment validated against video and GOTV delay; current time gate alone is insufficient.
- Round, halftime, overtime, match scoring and team reconciliation across data sources.
- OBS graphics with visibly degraded state when sources are stale.
- Operator manager, authenticated match setup, themes, scenes and manual overrides.
- Recording/replay: separate capture of video and event markers; no impact on game server.

## Protocol contract v1
`{ version, eventId, matchId, sourceId, type, sequence, occurredAt, tick?, payload }`

For the GSI adapter, `occurredAt` is receiver time, not the GSI provider's timestamp; provider timestamp is preserved when supplied. The adapter does not infer game ticks or video delay. A configured match ID scopes the session. The payload omits the auth object. Authentication is performed at ingest, not inside the engine.

## Reliability and security
Never publish privileged information to players. A stale source is flagged and its snapshot is withheld. Missing events are not silently skipped. History is bounded and rejects new events when full; it is not durable storage. Time gating guarantees only that later receiver timestamps are held back by a chosen delay; it does not guarantee accurate production synchronization. Avoid putting any privileged access information in public OBS overlays. A renderer failure must not interrupt the CS2 gameserver.

## Technology
Node.js 22+ and built-in tests; no final desktop UI, durable database, or backend transport contract has been selected.
