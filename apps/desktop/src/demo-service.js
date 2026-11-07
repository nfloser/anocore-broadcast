import { randomBytes } from 'node:crypto';
import { createBroadcastRuntime } from '../../../services/engine/src/runtime.js';
import { createPublicScoreboard } from '../../overlay/src/public-state.js';
import { createOverlayServer } from '../../overlay/src/server.js';
import { createDemoFrame } from '../../overlay/src/demo-fixture.js';
import { createDemoRadar } from '../../overlay/src/demo-radar.js';
import { createBroadcastSettings } from '../../manager/src/settings.js';
import { summarizeConnection } from './connection-diagnostics.js';

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
      const body = JSON.stringify(createDemoFrame(seq, token));
      let lastError;
      // The local receiver can reopen on the same port immediately after a
      // Live -> Demo switch. A pooled HTTP socket may be stale on the first
      // attempt even though the new server is listening. Retry only briefly.
      for (let attempt = 0; attempt < 3; attempt++) {
        if (stopped) return;
        try {
          const response = await fetch('http://127.0.0.1:' + receiver.port + '/gsi', {
            method: 'POST',
            headers: { 'content-type': 'application/json', connection: 'close' },
            body,
          });
          if (response.status !== 202) {
            throw new Error('Demo ingestion failed with HTTP ' + response.status);
          }
          seq++;
          return;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      throw lastError;
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
      mode: 'demo',
      hudUrl: 'http://127.0.0.1:' + hud.port + '/',
      getStatus: () => ({
        mode: 'demo', connection: 'synthetic', ageMs: null,
        diagnostics: summarizeConnection({ mode: 'demo', connection: 'synthetic', ageMs: null }),
      }),
      getSettings: () => settings.get(),
      updateSettings: changes => settings.update(changes),
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
