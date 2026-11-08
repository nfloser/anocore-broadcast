# Deterministic observer timeline (foundation)

`createMatchTimeline({ matchId, delayMs, staleAfterMs, capacity, clock })` accepts validated `observer.snapshot` envelopes and exposes `ingest()`, `view(at)` and `stats()`.

### Ordering and safety
- A source begins at sequence 1. Events with missing sequence predecessors are buffered up to 64; they are not rendered.
- Exact replays and conflicting old sequence numbers are rejected.
- A gap makes the source stale rather than silently showing wrong state.
- Event and view payloads are deep-cloned, preventing mutation of accepted data.
- Each source has a separate snapshot; it does not yet merge authoritative sources or teams.
- The default `retention: 'strict'` history stops accepting events at capacity. It intentionally does not silently evict records or claim durable operation.
- Explicit `retention: 'rolling'` is only for **volatile zero-delay local live previews**: the oldest committed history and duplicate-ID entries are pruned after a successful commit to keep the newest `capacity` events. The engine still tracks last sequence numbers and rejects old or conflicting sequences. The rolling window is **not** a replay history: querying an evicted timestamp or an older observer source returns no snapshot, not reconstructed data. Delayed feeds and journal persistence cannot enable rolling retention. Large out-of-order contiguous runs that exceed capacity still receive backpressure rather than truncating a batch.
- When the receiver wall clock jumps backwards, a rolling read selects the highest *committed source sequence* among frames eligible under the zero-delay cutoff. Strict/replay reads remain timestamp-ordered. The source freshness threshold still applies and future-dated frames are not exposed prematurely.

### Time alignment
`view(at)` uses cutoff `at - delayMs` and will not expose an event whose receiver timestamp is later than the cutoff. This is a **configurable time gate**, **not** verified alignment with CS2/GOTV video, demo ticks or OBS replay. Set delay based on measured end-to-end footage. Do not interpret the output as synchronized with the broadcast before actual validation.

### Known limits
In-memory only. Does not persist source sessions across restart. No gap recovery/snapshot rewind protocol, event-type payload schema, clock offset estimation, stable score reducer, global cross-source ordering, authentication or live adapter-to-engine wiring. An untrusted producer must pass through the authenticated GSI adapter first. These are required before production use.

## Local GSI receiver transport boundaries\n\nThe loopback-only authenticated HTTP receiver caps JSON request bodies at 256 KiB and now has a configurable `bodyTimeoutMs` with a default absolute 5-second deadline (50–60,000 ms allowed). An incomplete or slow body is disconnected without receiving an accepted event; it cannot refresh the live score. `runtime.close()` destroys only sockets owned by that receiver before waiting for HTTP shutdown, allowing Live→Demo switching despite pending partial POSTs. This timeout limits request handling, not CS2/GOTV broadcast latency or the staleness cutoff.\n\n## Optional durable journal (experimental)

Set `ANOCORE_JOURNAL_PATH` to a local file in a writable private directory. Each acknowledged event is synchronously appended to a JSON-lines journal before updating in-memory state. On restart the engine validates and replays the complete journal and resumes the local GSI event sequence. A recovered snapshot is withheld as stale until new data arrives; the receiver reports `waiting` after restart.

Journal storage uses an original base JSONL file followed by zero-padded sequential segments (for example `events.jsonl.000001`) with a default segment limit of 4 MiB. The aggregate limit remains 32 MiB. Segment rotation is automatic and lossless while capacity remains; recovery requires every segment in the original sequence. No segment is silently deleted. The journal tracks accumulated bytes instead of re-reading the full file for every append. Once the aggregate limit is full, POST requests fail with HTTP 503; no silent data loss or rollover occurs. The operator must stop the service and archive the complete journal and start a new match session as a separate maintenance procedure. Corruption or an incomplete final record blocks startup instead of silently discarding it. Protect journal contents: player names and match data may be stored in plaintext; credentials are stripped by the GSI normalizer. This is single-process, synchronous local persistence, **not** a distributed durable log or a guarantee against physical storage failure. No concurrent writers are supported.

## Integrity checkpoints (operator-controlled)

Call `runtime.checkpoint()` on a running, journal-enabled runtime (or `createEventJournal(...).checkpoint()` when stopped) to create an **integrity checkpoint** at `<journalPath>.checkpoint.json`. It records the length and SHA-256 hash of committed prefixes of every current segment; the manifest is replaced atomically. Startup verifies those prefixes before replay and refuses missing, corrupted or modified data. Events appended after a checkpoint are still allowed, including additional segments.

This is **not** a state snapshot and does **not** provide automatic compaction, retention, skip-ahead recovery, or protection from a malicious attacker who can alter both journal and manifest. The manifest does not include event contents, keys or secrets. Keep journals and checkpoints under the same restricted filesystem and back them up together. A verified state checkpoint and safe retention policy are future work.
