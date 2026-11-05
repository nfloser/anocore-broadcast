# AnoCore Broadcast

Independent CS2 broadcast production suite. The goal is a configurable and reliable CS2 broadcast workflow: live HUD, production control, tournament operations, observer tooling, and replay support.

> **Status: early development.** A local authenticated CS2 Game State Integration receiver is connected to an observer timeline with optional experimental local event journaling. There is now a **local OBS HUD prototype** for map, CT/T scores, round, status and spectator rosters with active weapons, utility counts and a reported phase timer when GSI provides them, but **no** full professional HUD, production manager, verified video sync, replay system or production-ready release.

## Principles
- Works on CS2 observer machines without requiring AnoCore, MatchZy or another HUD manager.
- Separates server/game events, observer snapshots and the broadcast video timeline.
- Exposes stale or unavailable data instead of pretending it is current.
- Protects security tokens and privileged controls from public broadcast output.
- Requires tests, CI and real operating checks before reliability claims.

## Workspace
- `packages/protocol` — versioned event envelope validation.
- `adapters/cs2` — GSI ingest and freshness tracking (**implemented**).
- `services/engine` — HTTP-to-engine pipeline, in-memory event ordering, optional journal recovery, gap detection, delayed snapshot reads (**partially implemented**).
- `adapters/anocore` — optional AnoCore/MatchZy integration (**planned**).
- `apps/overlay` — redesigned local OBS HUD with allowlisted spectator roster and demo-only synthetic radar (**initial implementation**).
- `apps/manager` — first authenticated local operator controls for team labels, colors and roster visibility (**implemented; optional local persistence**).

## Windows desktop preview

An early Electron desktop shell starts a fully synthetic HUD with a single click, includes sandboxed operator controls with persistent team colors/names, and stops its local GSI/HUD servers when closed. It is **not yet** a live production application. See [Windows desktop preview](apps/desktop/README.md) for `npm run desktop`, unsigned CI artifacts and limitations. A tested, signed Windows release remains tracked in Issue #41.

## Quick preview

Run `npm run demo`, then open `http://127.0.0.1:3009/`. The viewer visibly marks the generated content as **DEMO** and runs entirely on localhost. Set `ANOCORE_ADMIN_TOKEN` (32+ bytes) first to use the local Operator Manager with the demo at `http://127.0.0.1:3010/`. For real CS2 ingest see the [OBS quickstart](apps/overlay/README.md).

## Checks

Requires Node.js 22+:

```sh
npm test
npm run check
```

See the [OBS scoreboard quickstart](apps/overlay/README.md), [CS2 adapter instructions](adapters/cs2/README.md) and [timeline API](services/engine/README.md).

## Documentation
[Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md) · [Engineering guidelines](AGENTS.md) · [Security](SECURITY.md)

HTTP-to-engine integration is tested with fixtures, but live CS2 observer compatibility and video synchronization have not yet been validated. No game server changes are required by this foundation.
