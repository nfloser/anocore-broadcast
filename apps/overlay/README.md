# AnoCore Broadcast · first OBS scoreboard

This is a *minimal working scoreboard*, not a full ten-player broadcast HUD. It reads only the authenticated in-process observer timeline and publishes a tiny, intentionally sanitized view. When observer-only `allplayers_*` data is available, the browser API includes allowlisted player names, health, armor, cash and K/A/D. Steam IDs, weapon inventories, arbitrary fields and credentials are not exposed. This is still sensitive spectator information, so keep the browser source local.

## Preview without CS2

Run `npm run demo` from the repository root. Open `http://127.0.0.1:3009/` in a browser or OBS Browser Source (1920 × 500). The app sends synthetic 5v5 match fixtures through the normal local authenticated GSI receiver and updates approximately every two seconds. A permanent red **DEMO · SYNTHETIC DATA** marker identifies the simulated output. It is not a live CS2 feed. The demo includes a clearly marked abstract radar grid driven by fake spectator world coordinates through the tested map transform, not a calibrated Nuke map. Set `ANOCORE_ADMIN_TOKEN` (32+ bytes) before `npm run demo` to also enable the local operator panel at `http://127.0.0.1:3010/`, using the same controls as live mode. Optional `ANOCORE_MANAGER_CONFIG_PATH` retains the demo layout across restarts. The demo is an operator visual preview and an end-to-end test aid, not broadcast-ready production software.

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

## Local operator manager (early preview)

To enable the operator panel, set a **separate** random `ANOCORE_ADMIN_TOKEN` environment variable (32+ bytes) before running `npm run broadcast`:

```powershell
$env:ANOCORE_ADMIN_TOKEN="PUT_A_DIFFERENT_RANDOM_32_BYTE_SECRET_HERE"
npm run broadcast
```

Open `http://127.0.0.1:3010/`, enter the token and click **Connect**. You can configure CT/T labels, colors and roster visibility. Changes appear in OBS without restarting the receiver. By default changes are in memory and revert after a restart. To enable persistence, set a private local file path before starting:

```powershell
$env:ANOCORE_MANAGER_CONFIG_PATH="$HOME\\anocore-broadcast-operator.json"
```

The optional versioned JSON file contains only public HUD settings, never the operator or GSI tokens. It is created after a successful settings change. Existing malformed files abort startup rather than silently discarding your layout. Back up the file before upgrades; avoid network shares and concurrent writers. Do not reuse the GSI token as an operator token. The manager is disabled if the environment variable is absent, binds only to loopback and rejects cross-origin writes. Never expose its port outside the observer machine.

## Equipment from observer GSI

The GSI sample configuration now requests `allplayers_weapons`. When the spectator receives the weapons dictionary, the roster shows the weapon marked `active` and a bounded count of entries marked `type: Grenade`. Without a weapons dictionary, both fields are explicitly unknown; an empty inventory reports zero utility. No skins, raw inventory, ammo data, SteamIDs or other arbitrary fields are returned to the browser. Verify live data against an actual CS2 observer before relying on this display in a production broadcast.

## Reported spectator phase timer

The CS2 observer configuration subscribes to `phase_countdowns`. Where present, the browser HUD displays the reported `phase_ends_in` as `GSI TIMER` (minutes and seconds). It is refreshed with GSI snapshots, not a continuously interpolated local clock, and is removed when data becomes stale. It is **not** guaranteed to match the OBS/GOTV video frame; production-quality synchronization still requires a measured broadcast clock and real CS2 observation testing.
