# Windows desktop preview (experimental)

The repository now contains an Electron desktop shell for a **synthetic OBS HUD demonstration only**. It bundles Chromium and Node with the application, opens the same local HUD used by the browser demo, and owns/stops the GSI ingest + timeline + overlay services. The embedded renderer cannot access Node APIs or the randomly generated ingest secret. The HUD continues to show **DEMO · SYNTHETIC DATA** and the uncalibrated radar warning.

## Local development

Install dependencies with `npm install` (Node.js 22+ required *for development*), then run `npm run desktop`. The preview window opens, and **Broadcast → Copy OBS Browser Source URL** copies the loopback address for OBS. Closing the window stops its owned HTTP services.

Ports 3008 and 3009 must be free. If a separate `npm run demo` session is still running, terminate it first. The desktop application does not terminate other programs or take over their ports.

## Windows portable preview build

The `Windows desktop preview` GitHub Actions workflow packages an unsigned x64 portable Electron executable and publishes its SHA-256 checksum as a workflow artifact. It is a test artifact, **not** a signed/released/production-ready installation. Preview artifacts must be independently tested on an actual clean Windows machine; security prompts may appear for unsigned binaries.

## Still required for Issue #41

Production live GSI configuration and secure operator controls inside the desktop shell, OS-backed secret storage, mode switching, a setup wizard, a clean Windows x64 smoke test, signed installer, updates, release process, and measured video/GOTV synchronization. None of those are implied by the desktop demo shell.
