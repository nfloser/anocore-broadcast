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

## Optional durable journal (experimental)

Set `ANOCORE_JOURNAL_PATH` to a local file in a writable private directory. Each acknowledged event is synchronously appended to a JSON-lines journal before updating in-memory state. On restart the engine validates and replays the complete journal and resumes the local GSI event sequence. A recovered snapshot is withheld as stale until new data arrives; the receiver reports `waiting` after restart.

The journal defaults to a 32 MiB limit. Once full, POST requests fail with HTTP 503; no silent data loss or rollover occurs. The operator must stop the service and archive or rotate the journal as a separate maintenance procedure. Corruption or an incomplete final record blocks startup instead of silently discarding it. Protect journal contents: player names and match data may be stored in plaintext; credentials are stripped by the GSI normalizer. This is single-process, synchronous local persistence, **not** a distributed durable log or a guarantee against physical storage failure. No concurrent writers are supported.
