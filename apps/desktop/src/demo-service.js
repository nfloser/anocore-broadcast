import { randomBytes } from 'node:crypto';
import { createBroadcastRuntime } from '../../../services/engine/src/runtime.js';
import { createPublicScoreboard } from '../../overlay/src/public-state.js';
import { createOverlayServer } from '../../overlay/src/server.js';
import { createDemoFrame } from '../../overlay/src/demo-fixture.js';
import { createDemoRadar } from '../../overlay/src/demo-radar.js';
import { createBroadcastSettings } from '../../manager/src/settings.js';

/**
 * Electron owns these listeners. No reusable key is stored or transferred to
 * the renderer. Each launched demo uses the same ingest path as CLI demo.
 */
export async function startDesktopDemo({
  receiverPort = 3008,
  overlayPort = 3009,
  settingsPath,
  intervalMs = 2000,
} = {}) {
  if (!Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 60000) {
    throw new TypeError('Invalid demo interval');
  }
  const token = randomBytes(32).toString('hex');
  const settings = createBroadcastSettings({ filePath: settingsPath });
  const runtime = createBroadcastRuntime({
    matchId: 'desktop-demo', token, port: receiverPort, staleAfterMs: 15000,
  });
  let overlay = null;
  let timer = null;
  let stopped = false;
  let pending = Promise.resolve();
  let seq = 0;
  try {
    const receiver = await runtime.listen();
    overlay = createOverlayServer({
      port: overlayPort,
      scoreboard: () => {
        const view = runtime.view();
        const state = createPublicScoreboard(view);
        const config = settings.get();
        return {
          ...state,
          demo: true,
          settings: config,
          radar: state.status === 'live' ? createDemoRadar(view) : null,
          players: config.showRoster ? state.players : [],
        };
      },
    });
    const hud = await overlay.listen();
    async function update() {
      if (stopped) return;
      const response = await fetch('http://127.0.0.1:' + receiver.port + '/gsi', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(createDemoFrame(seq++, token)),
      });
      if (response.status !== 202) {
        throw new Error('Demo ingestion failed with HTTP ' + response.status);
      }
    }
    await update();
    timer = setInterval(() => {
      pending = pending.then(update).catch(() => {
        // Do not claim valid live data after ingestion stops working.
        // Freshness checks eventually hide the old snapshot.
        clearInterval(timer);
        timer = null;
      });
    }, intervalMs);
    return {
      hudUrl: 'http://127.0.0.1:' + hud.port + '/',
      async close() {
        if (stopped) return;
        stopped = true;
        if (timer !== null) clearInterval(timer);
        await pending;
        await overlay.close();
        await runtime.close();
      },
    };
  } catch (error) {
    stopped = true;
    if (timer !== null) clearInterval(timer);
    if (overlay) await overlay.close();
    await runtime.close();
    throw error;
  }
}
