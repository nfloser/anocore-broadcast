# Delivery roadmap

All stages require tests, documentation, CI and an operational acceptance run. No stage is complete just because a component renders in a demo.

## Foundation
Versioned event schema; validation; deterministic ingest/replay fixtures; security boundaries; automated CI.

## Live match pipeline
Observer GSI ingest, optional server adapter, event de-duplication, per-source sequence tracking, source freshness, snapshot recovery, round state and GOTV delay alignment. Validate against recorded matches.

## Viewer graphics
Configurable ten-player HUD, economy, utility, killfeed, calibrated spectator-only radar, bomb state, round history and OBS-compatible overlay. Accessibility and broadcast-safe fallback states.

## Production manager
Multi-match/BO series management, themes, layouts, tournament brackets, verified operator controls, authenticated roles, audit trails, scene switching and safe overrides.

## Advanced operations
Observer tooling, replay markers and video-buffer integration, player cams, multicamera, sponsor packages, advanced match analytics, failover, monitoring and Windows distribution.

## Readiness gates
End-to-end evidence with actual CS2/GSI sources, long-running BO3/BO5 tests, delayed observer validation, reconnection chaos tests, operator runbook, recovery drill, security review, and release rollback procedure.

## Scope discipline
Features are independently specified in Issues and delivered through reviewed PRs. No proprietary production stack is required at runtime. Claims of parity with an esports event require feature-by-feature evidence rather than resemblance of graphics.
