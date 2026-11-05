# Architecture: initial decisions

## Product boundary
AnoCore Broadcast is a standalone product, not a submodule of the gameserver. An observer's CS2 Game State Integration provides a first-party data source without AnoCore. Richer server-side data is provided by optional authenticated adapters.

## Implemented
- Versioned protocol envelope validation in `packages/protocol`.
- CS2 observer GSI HTTP receiver in `adapters/cs2`: loopback binding, required shared secret, bounded JSON body, conservative normalization into `observer.snapshot` events, in-memory sequence and source freshness.
- Regression tests for malformed, unauthorized, oversized and disconnected/stale conditions.

## Planned
- Engine: de-duplicate and order events per source; maintain match state; recover snapshots after reconnect.
- Broadcast clock: align observer video with received events and GOTV delay. Prevent future-event spoilers.
- OBS graphics: render current data and visibly degrade on stale sources.
- Operator manager: authenticated match setup, themes, scenes, and manual overrides.
- Recording/replay: separate capture of video and event markers; no impact on game server.

## Protocol contract v1
`{ version, eventId, matchId, sourceId, type, sequence, occurredAt, tick?, payload }`

For the GSI adapter, `occurredAt` is the local receiver time, not the GSI provider's epoch timestamp; original provider timestamp is preserved in the normalized payload when supplied. The adapter does not infer game ticks, match ID, or video delay. A configured match ID scopes the session. The payload omits the auth object. Authentication is performed at the ingest boundary and does not make event contents inherently trustworthy.

## Risk boundaries
Never publish privileged information to players. A stale source must be flagged. GSI may not provide comprehensive spectator data. It is not a guaranteed substitute for live observer video. Ensure permission and sync controls before displaying full competitive information. Do not expose management credentials in public OBS overlays. A renderer failure must not interrupt the gameserver.

## Technology
Node.js 22+ and its built-in test runner are used for the initial services. No final desktop UI, durable store, or complete transport contract has been selected.
