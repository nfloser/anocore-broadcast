# AnoCore Broadcast

Independent CS2 broadcast production suite. The long-term goal is a configurable and reliable workflow for CS2 broadcasts: live HUD, production control, tournament operations, observer tooling, and replay support.

> **Status: early development.** A basic, secured local CS2 Game State Integration receiver exists. There is **no** working ten-player HUD, full broadcast manager, demo time synchronization, replay system, or production-ready release yet.

## Principles
- Works on CS2 observer machines without requiring AnoCore, MatchZy, or another HUD manager.
- Distinguishes live game events, observer state, and the video broadcast timeline.
- Exposes stale and unavailable state rather than pretending data is current.
- Keeps security tokens and privileged controls out of read-only broadcast output.
- Requires tests, CI, and operational verification before making reliability claims.

## Workspace
- `packages/protocol` — versioned event-envelope validation.
- `adapters/cs2` — initial GSI ingest and freshness tracking (**implemented**).
- `services/engine` — source ordering, match state and broadcast time alignment (**planned**).
- `adapters/anocore` — optional AnoCore/MatchZy integration (**planned**).
- `apps/overlay` — OBS graphics (**planned**).
- `apps/manager` — production controls (**planned**).

## Developer checks

Requires Node.js 22+:

```sh
npm test
npm run check
```

To run the local GSI receiver see [adapter instructions](adapters/cs2/README.md).

## Documentation
[Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md) · [Engineering guidelines](AGENTS.md) · [Security](SECURITY.md)

The first adapter is not yet validated against a live CS2 observer; this is necessary before enabling broadcast graphics.
