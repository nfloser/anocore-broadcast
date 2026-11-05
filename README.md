# AnoCore Broadcast

Independent CS2 broadcast production suite. The goal is a configurable and reliable CS2 broadcast workflow: live HUD, production control, tournament operations, observer tooling, and replay support.

> **Status: early development.** A local authenticated CS2 Game State Integration receiver and an in-memory observer timeline exist. There is **no** working ten-player HUD, full broadcast manager, actual demo/video synchronization, replay system or production-ready release.

## Principles
- Works on CS2 observer machines without requiring AnoCore, MatchZy or another HUD manager.
- Separates server/game events, observer snapshots and the broadcast video timeline.
- Exposes stale or unavailable data instead of pretending it is current.
- Protects security tokens and privileged controls from public broadcast output.
- Requires tests, CI and real operating checks before reliability claims.

## Workspace
- `packages/protocol` — versioned event envelope validation.
- `adapters/cs2` — GSI ingest and freshness tracking (**implemented**).
- `services/engine` — in-memory event ordering, gap detection, delayed snapshot reads (**partially implemented**).
- `adapters/anocore` — optional AnoCore/MatchZy integration (**planned**).
- `apps/overlay` — OBS graphics (**planned**).
- `apps/manager` — operator controls (**planned**).

## Checks

Requires Node.js 22+:

```sh
npm test
npm run check
```

See the [CS2 adapter instructions](adapters/cs2/README.md) and [timeline API](services/engine/README.md).

## Documentation
[Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md) · [Engineering guidelines](AGENTS.md) · [Security](SECURITY.md)

Full live CS2-to-engine integration and video sync have not yet been validated. No game server changes are required by this foundation.
