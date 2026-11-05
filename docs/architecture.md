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

- Loopback-only read-only scoreboard server projects a small allowlisted subset of delayed state to OBS. The expanded read-only projection may include broadcast player names, health, money and stats from spectator GSI; SteamIDs, arbitrary weapons and authentication secrets are not available from its endpoint. It remains loopback-only and must not be exposed to players.

## Position telemetry boundary
The observer GSI adapter can ingest and strictly parse `allplayers_position` and `forward` as finite three-dimensional world-space vectors. These values stay in the internal normalized observer payload and are deliberately **not** exposed through the public OBS projection. Map-specific coordinate calibration, orientation, altitude layering, latency verification and spectator-only access rules must be implemented and tested before introducing radar graphics. The sender is subject to GSI's own observer visibility rules, and this project must not create a player-facing position leak.

## Radar calibration boundary
A tested, strict two-anchor similarity transform is available in `services/engine/src/calibration.js`. Its profiles must be explicitly approved and matched to a map. It handles optional non-overlapping altitude floors, rotation, scaling and translation without inventing coordinates. There are **no verified real-map calibration profiles** and no live browser radar endpoint yet. An isolated synthetic demo can project deterministic GSI fixture positions onto an abstract grid. It is permanently marked as fictitious and is never imported into the live runtime. Map imagery, observer-only role gating, and GOTV video delay still require acceptance work.

## Planned\n- Type-specific payload schemas, an authenticated read API for approved broadcast operators, and secure runtime lifecycle management.
- Production-grade journal lifecycle: rotation, recovery after partial writes, cross-process locking, bounded memory, and resilience to disk failures. The initial single-process write-ahead journal is optional and experimental.
- Broadcast clock alignment validated against video and GOTV delay; current time gate and displayed GSI-reported phase timer alone are insufficient.
- Round, halftime, overtime, match scoring and team reconciliation across data sources.
- Full OBS broadcast graphics including players, radar, team names, events and theme editor; only a small CT/T scoreboard exists today.
- Full operator management including multi-user roles, persisted configuration, tournament match setup, scenes and auditable overrides. An initial token-protected loopback editor for CT/T names, colors and roster visibility exists, with optional atomic local persistence of validated display settings (no credentials).
- Recording/replay: separate capture of video and event markers; no impact on game server.

## Protocol contract v1
`{ version, eventId, matchId, sourceId, type, sequence, occurredAt, tick?, payload }`

For the GSI adapter, `occurredAt` is receiver time, not the GSI provider's timestamp; provider timestamp is preserved when supplied. The adapter does not infer game ticks or video delay. A configured match ID scopes the session. The payload omits the auth object. Authentication is performed at ingest, not inside the engine.

## Reliability and security
Never publish privileged information to players. A stale source is flagged and its snapshot is withheld. Missing events are not silently skipped. History is bounded and rejects new events when full; it is not durable storage. Time gating guarantees only that later receiver timestamps are held back by a chosen delay; it does not guarantee accurate production synchronization. Avoid putting any privileged access information in public OBS overlays. A renderer failure must not interrupt the CS2 gameserver.

## Technology
Node.js 22+ and built-in tests; no final desktop UI, durable database, or backend transport contract has been selected.

## Desktop observer modes
The desktop shell starts in explicitly synthetic Demo mode. A separately constructed Live observer mode runs the existing loopback authenticated GSI receiver and only the allowlisted freshness-gated OBS projection. A new random key is generated in the main process for every Live session; it can be written only by an explicit native CS2 CFG export, not by a renderer or browser API. Switching releases owned ports before binding the next mode, and failure returns to a fresh synthetic demo when possible. The user-facing connection label reflects received authenticated GSI freshness. Real observer acceptance, production video sync and robust credential lifecycle are not complete.
