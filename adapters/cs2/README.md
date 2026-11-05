# CS2 observer GSI adapter (initial)

This adapter receives CS2 GSI HTTP POST snapshots on loopback, normalizes a conservative subset and emits versioned `observer.snapshot` envelopes. It can run without AnoCore or MatchZy.

## Local trial

1. On the **observer PC**, install Node.js 22+, choose a random secret (at least 16 UTF-8 bytes) and set `ANOCORE_GSI_TOKEN` in your environment. Do not commit the token.
2. Run `ANOCORE_GSI_TOKEN=<your-secret> ANOCORE_MATCH_ID=match-1 node adapters/cs2/src/start.js` (PowerShell: set environment variables with `$env:ANOCORE_GSI_TOKEN="..."` and `$env:ANOCORE_MATCH_ID="match-1"`, then run the Node command).
3. Copy `config/gamestate_integration_anocore.cfg.example` to the CS2 `game/csgo/cfg/gamestate_integration_anocore.cfg` path (relative to the CS2 installation) and replace the token placeholder with the same secret. Restart CS2 after creating the file.
4. Connect as an authorized CS2 observer. GET `http://127.0.0.1:3008/health` shows `waiting`, `live` or `stale`.

CS2 GSI typically sends a subset of keys based on configuration and player permissions. The adapter currently handles only provider/map/round/local-player/bomb data; it does **not** provide a full ten-player HUD, positional radar, demo clock alignment or replay output. Server-specific integration and real CS2 end-to-end validation remain open.

## Security and operational limits

- Only loopback binding is supported. Do **not** expose this HTTP endpoint to a public network.
- Auth is a required shared token inside GSI JSON; transport is plain HTTP on loopback.
- The token is never put into normalized events.
- Payloads above 256 KiB and unauthenticated requests are rejected.
- The health endpoint returns freshness only, never credentials or match state.
- Event delivery is synchronous and in-memory. This initial adapter has no durable queue or reconnection state; restart resets sequence numbering.
- The sender identity cannot be cryptographically verified beyond the shared secret.

## Data flow to the engine

The `start.js` command now creates the GSI receiver **and** the in-memory observer timeline. Each authorized GSI POST is normalized into an `observer.snapshot` event and committed to the engine before an HTTP 202 response is sent.

For in-process consumers, import `createBroadcastRuntime` from `services/engine/src/runtime.js` and call `view(at)` to obtain the delayed, freshness-gated snapshot. Use the optional `ANOCORE_BROADCAST_DELAY_MS` environment variable to set a nonnegative read delay. It is only a configurable time gate, **not** video-synchronized proof.

The HTTP API intentionally has **no match-state output endpoint**: raw observer data may be privileged. A properly authenticated and permission-filtered transport for the OBS renderer is future work. When the engine refuses a message (for example due to its bounded capacity), the endpoint responds with HTTP 503, and the ingest sequence does not advance. Long-running ingestion still needs durable storage and an explicit recovery policy.

Integration tests cover authenticated HTTP POST through the real receiver into the timeline and delayed or stale read behavior. Testing on an actual CS2 observer PC remains outstanding.
