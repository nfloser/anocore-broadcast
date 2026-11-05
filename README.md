# AnoCore Broadcast

Independent CS2 broadcast production suite. The long-term goal is a reliable, configurable broadcast workflow for CS2 servers, including a live HUD, production control, tournament operations, observer tooling, and replay support.

> **Status: early foundation.** There is no working CS2 connection, live HUD, observer control, or production-ready release yet. The repository currently contains a tested event protocol and engineering documentation.

## Principles

- Works without an AnoCore gameserver installation; integrations are optional.
- Separates live server state, observer state, and the delayed broadcast timeline.
- Treats stale, missing, or unverified data as unavailable rather than displaying potentially incorrect information.
- Keeps credentials and administrative controls out of public OBS overlays.
- Makes event input deterministic and replayable for validation and incident investigation.
- Requires automated quality gates and operational testing before production claims.

## Workspace

- `packages/protocol` — versioned event-envelope validation (implemented).
- `services/engine` — match state, event ordering, reconciliation, broadcast clock (planned).
- `adapters/cs2` — observer/GSI ingest (planned).
- `adapters/anocore` — optional AnoCore/MatchZy adapter (planned).
- `apps/manager` — production-control application (planned).
- `apps/overlay` — graphics and OBS output (planned).

See [architecture](docs/architecture.md), [roadmap](docs/roadmap.md), and [engineering guidelines](AGENTS.md).

## Local checks

Requires Node.js 22 or newer. No dependency installation is needed for the initial protocol package.

```sh
npm test
npm run check
```

## Delivery status

Functional scope and acceptance criteria are tracked in GitHub Issues. A browser overlay, Windows installer and replay engine do not exist yet. This project does not bundle another HUD manager.
