# AnoCore Broadcast · first OBS scoreboard

This is a *minimal working scoreboard*, not a full ten-player broadcast HUD. It reads only the authenticated in-process observer timeline and publishes a tiny, intentionally sanitized view. When observer-only `allplayers_*` data is available, the browser API includes allowlisted player names, health, armor, cash and K/A/D. Steam IDs, weapon inventories, arbitrary fields and credentials are not exposed. This is still sensitive spectator information, so keep the browser source local.

## Preview without CS2

Run `npm run demo` from the repository root. Open `http://127.0.0.1:3009/` in a browser or OBS Browser Source (1920 × 500). The app sends synthetic 5v5 match fixtures through the normal local authenticated GSI receiver and updates approximately every two seconds. A permanent red **DEMO · SYNTHETIC DATA** marker identifies the simulated output. It is not a live CS2 feed. The demo is an operator visual preview and an end-to-end test aid, not broadcast-ready production software.

## Start locally

1. Install Node.js 22 or later; clone the repository.
2. Choose a random secret at least 16 bytes long and configure the CS2 observer GSI file as described in [the adapter guide](../../adapters/cs2/README.md).
3. On the **same PC as the CS2 observer**, use PowerShell:
   ```powershell
   $env:ANOCORE_MATCH_ID="broadcast-1"
   $env:ANOCORE_GSI_TOKEN="REPLACE_WITH_YOUR_LONG_RANDOM_SECRET"
   $env:ANOCORE_BROADCAST_DELAY_MS="0"
   npm run broadcast
   ```
4. In OBS add a **Browser Source**, URL `http://127.0.0.1:3009/`, width 1920, height 500. Place it at the top of the scene.
5. Check `http://127.0.0.1:3008/health` for GSI freshness. The scoreboard shows unavailable until matching GSI arrives.

The configured delay is only a local read gate, not verified synchronization with GOTV/OBS video. Observe the source delay before going live. The scoreboard currently shows CT/T side scores, map, round and limited round/bomb status where GSI provides them. It can show basic ten-player panels when spectator data is available, but not verified team identities, exact round clock, radar, all weapons, killfeed, replay or operator controls. Those require further adapters and real CS2 tests.

The scoreboard HTTP server binds **only to localhost** on port 3009, sends no CORS headers and exposes no privileged data. Neither the GSI token nor a public state endpoint should be exposed outside the trusted observer machine. This prototype does not support distributed production yet.
