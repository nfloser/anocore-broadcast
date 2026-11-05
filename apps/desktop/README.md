# Windows desktop preview (experimental)

The repository now contains an Electron desktop shell for an **experimental local OBS HUD preview and local CS2 observer input**. It bundles Chromium and Node with the application, opens the same local HUD used by the browser demo, provides a separate sandboxed operator-controls window, and owns/stops the GSI ingest + timeline + overlay services. The embedded renderer cannot access Node APIs or the randomly generated ingest secret. Live and Demo modes are separately started and shut down inside the desktop main process. The HUD continues to show **DEMO · SYNTHETIC DATA** and the uncalibrated radar warning.

## Local development

Install dependencies with `npm install` (Node.js 22+ required *for development*), then run `npm run desktop`. The preview window opens, and **Broadcast → Copy OBS Browser Source URL** copies the loopback address for OBS. Closing the window stops its owned HTTP services.

Ports 3008 and 3009 must be free. If a separate `npm run demo` session is still running, terminate it first. The desktop application does not terminate other programs or take over their ports.

## Built-in operator controls

Open **Broadcast → Operator Controls** (or `Ctrl+,`) inside the desktop preview to edit CT/T team names, accent colors and roster visibility. Changes apply to the OBS preview without restarting the app and are stored as validated public-only settings at `<Electron userData>/operator-settings.json`. This file contains no credentials. The controls use restricted Electron IPC rather than a browser-accessible administrator port: no administrator token is exposed to the renderer, and there is no open port 3010 for the desktop version. No remote operation or team-side data access is provided.

The demo preview and operator panel are separate windows. Close the main HUD window to stop the owned receiver and HUD servers. Settings persist across desktop restarts, but are scoped to this Windows user and this app build.

## Switching between Demo and local CS2 Live Observer

The app starts in **Demo** mode. Use **Broadcast → Start Live Observer** to stop the synthetic feed and begin waiting for a real, authenticated **local** spectator GSI source. While waiting, the HUD intentionally shows unavailable rather than fake scores. Open **Broadcast → Operator Controls** to see `Waiting for CS2 observer`, `Receiving observer data` or `Observer data stale`. Use **Broadcast → Start Demo** to switch back.

In Live mode choose **Broadcast → Export CS2 GSI Config…**. Save `gamestate_integration_anocore.cfg` into your CS2 installation's `game/csgo/cfg/` folder (for example under the Steam Counter-Strike Global Offensive installation). The app searches the standard Steam directory and libraries registered in `libraryfolders.vdf`, then offers a detected CS2 game configuration folder for confirmation. A manual Save dialog remains available if Steam is installed elsewhere, the library metadata is invalid, or CS2 cannot be located. The discovery process only reads local Steam metadata; it does not change Steam or your game files unless you explicitly save. You may save elsewhere and copy it yourself. Restart the game, run a **spectator/GOTV observation** that supplies the requested data, and keep Live mode running.

The exported CFG contains a randomly generated authentication key required by CS2. **Treat the CFG as a secret and do not share it.** On Windows, Electron's OS-backed safeStorage encrypts the key for the current Windows user and saves only the ciphertext at `<Electron userData>/observer-credential.json`. The same key is reused after normal application restarts and Demo/Live switches, so **you do not need to re-export the CFG after each restart**. No key appears in the operator settings file, browser state or renderer. Encryption/decryption failures and corrupted credential files block Live mode instead of silently changing the key. To rotate the key, first switch to Demo, select **Broadcast → Reset saved GSI key…** and explicitly confirm. Then start Live, export a new CFG and deliberately replace the old game file. The app refuses to overwrite an existing CFG automatically, even if the Save dialog confirms replacement. Resetting a saved key does not edit any existing game file. A different Windows account may not be able to decrypt this user's key. Do not delete a damaged key file or reset it without understanding that you will have to replace the CS2 CFG. Do not share exported CFGs because they contain the session credential. This initial version assumes CS2 and the application run on the same Windows machine and listens on `127.0.0.1:3008`.

The OBS Browser Source URL remains `http://127.0.0.1:3009/`, copied via the Broadcast menu. The live HUD does **not** include the synthetic demo radar, does not publish player world coordinates, and has no verified GOTV/video-frame synchronization. Test the source using an authorized observer only; this integration has not yet undergone a real CS2 or clean Windows acceptance test.

## Windows portable preview build

The `Windows desktop preview` GitHub Actions workflow packages an unsigned x64 portable Electron executable and publishes its SHA-256 checksum as a workflow artifact. It is a test artifact, **not** a signed/released/production-ready installation. Preview artifacts must be independently tested on an actual clean Windows machine; security prompts may appear for unsigned binaries.

## Windows packaged runtime smoke test

The Windows CI workflow now launches the **packaged unpacked Electron executable** from `dist/win-unpacked` (the same packaged application image used for the portable EXE), waits for the loopback OBS HTML and sanitized synthetic 5v5 JSON to become available, requests normal main-window shutdown, verifies that both local ports are released, and repeats startup/shutdown to catch restart regressions. The smoke-test executable includes its own Electron runtime; it does not rely on a system Node installation at runtime. On failure, the CI job fails before publishing a preview artifact.

This is a **Windows CI-runner check only**, not a hands-on clean-PC Windows or Defender test and not proof that real CS2/GOTV observer data is correctly presented.

## Still required for Issue #41

A completed setup wizard, automatic CS2 folder discovery, actual observer validation, robust match lifecycle, clean-machine Windows x64 user acceptance, signed installer, updates, release process, and measured video/GOTV synchronization. None of those are implied by the desktop demo shell.
