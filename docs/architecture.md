# Architecture: initial decisions

## Product boundary
AnoCore Broadcast is a standalone product, not a submodule of the gameserver. A broadcaster may connect through an observer's CS2 Game State Integration without installing the AnoCore server plugin. Richer server-side data and automation will use optional, authenticated adapters.

## Proposed logical components
1. **Ingest adapters:** translate observer GSI and approved server integrations to versioned events; explicitly record source and event time.
2. **Engine:** validate envelopes, de-duplicate and order events per source, maintain match state and recover snapshots after reconnect.
3. **Broadcast clock:** map game ticks and observed capture times onto the delayed viewer timeline. Never show future events before corresponding video frames.
4. **Overlay renderer:** read-only, least-privilege browser graphics; visible degraded mode when data is stale.
5. **Operator manager:** authenticated administration of matches, themes, scenes and manual overrides.
6. **Recording and replay:** separate video capture/storage and event markers; failure must not interrupt the game server.

Only the versioned envelope validation exists today.

## Protocol contract v1
`{ version, eventId, matchId, sourceId, type, sequence, occurredAt, tick?, payload }`

- `version` is an exact integer protocol version (currently 1).
- `eventId` supports idempotent event processing.
- `matchId` isolates concurrent matches.
- `sourceId` identifies an ingest source, while `sequence` is source-local.
- `occurredAt` is event time in UTC epoch milliseconds. Ingest receive time will be tracked separately.
- `tick` is optional. It must not be fabricated when unavailable.
- `payload` is an object; event-type schemas and authorization remain future work.
- Validation does not authenticate a sender or establish data correctness.

## Reliability requirements
- A stale source must be marked stale; no frozen scoreboard should masquerade as live.
- Observer switching, reconnects, halftime, overtime, rematches, and missing events need deterministic test fixtures.
- Time alignment must be validated against actual broadcast video and GOTV delay.
- Separate process boundaries so a rendering crash cannot stop a CS2 match.
- Never expose admin credentials or privileged live information in a public overlay.
- Establish measured latency, recovery time, and availability objectives after instrumentation exists.

## Technology
Node.js 22+ is used for the initial package and dependency-free test runner. No final desktop UI, transport, database, or backend language has been selected. Decisions will be recorded before implementation.
