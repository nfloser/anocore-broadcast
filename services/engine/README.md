# Deterministic observer timeline (foundation)

`createMatchTimeline({ matchId, delayMs, staleAfterMs, capacity, clock })` accepts validated `observer.snapshot` envelopes and exposes `ingest()`, `view(at)` and `stats()`.

### Ordering and safety
- A source begins at sequence 1. Events with missing sequence predecessors are buffered up to 64; they are not rendered.
- Exact replays and conflicting old sequence numbers are rejected.
- A gap makes the source stale rather than silently showing wrong state.
- Event and view payloads are deep-cloned, preventing mutation of accepted data.
- Each source has a separate snapshot; it does not yet merge authoritative sources or teams.
- The bounded history stops accepting events at capacity. It intentionally does not silently evict records or claim durable operation.

### Time alignment
`view(at)` uses cutoff `at - delayMs` and will not expose an event whose receiver timestamp is later than the cutoff. This is a **configurable time gate**, **not** verified alignment with CS2/GOTV video, demo ticks or OBS replay. Set delay based on measured end-to-end footage. Do not interpret the output as synchronized with the broadcast before actual validation.

### Known limits
In-memory only. Does not persist source sessions across restart. No gap recovery/snapshot rewind protocol, event-type payload schema, clock offset estimation, stable score reducer, global cross-source ordering, authentication or live adapter-to-engine wiring. An untrusted producer must pass through the authenticated GSI adapter first. These are required before production use.
