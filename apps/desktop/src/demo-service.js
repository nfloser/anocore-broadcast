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
  requestTimeoutMs = 1500,
  fetchImpl = fetch,
} = {}) {
  if (!Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 60000) {
    throw new TypeError('Invalid demo interval');
  }
  if (!Number.isSafeInteger(requestTimeoutMs) ||
      requestTimeoutMs < 50 || requestTimeoutMs > 10000) {
    throw new TypeError('Invalid demo request timeout');
  }
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('Invalid demo fetch adapter');
  }
  const token = randomBytes(32).toString('hex');
  const settings = createBroadcastSettings({ filePath: settingsPath });
  const runtime = createBroadcastRuntime({
    matchId: 'desktop-demo', token, port: receiverPort, staleAfterMs: 15000,
  });
  let overlay = null;
  let timer = null;
  let stopped = false;
  let degraded = false;
  let pending = Promise.resolve();
  let updating = false;
  const shutdown = new AbortController();
  let seq = 0;
  try {
    const receiver = await runtime.listen();
    overlay = createOverlayServer({
      port: overlayPort,
      scoreboard: () => {
        const view = runtime.view();
        const state = createPublicScoreboard(view);
        const config = settings.get();
        // A failed synthetic writer cannot leave a recent-looking old score
        // visible just because the receiver freshness threshold has not elapsed.
        const visible = !degraded && state.status === 'live';
        if (!visible) {
          // Do not forward fields from a previously live snapshot. OBS clients
          // may inspect score properties without checking status first.
          return { status: 'unavailable', demo: true, settings: config,
            radar: null, players: [] };
        }
        return {
          ...state,
          demo: true,
          settings: config,
          radar: createDemoRadar(view),
          players: config.showRoster ? state.players : [],
        };
      },
    });
    const hud = await overlay.listen();
    async function timedFetch(url, options) {
      const controller = new AbortController();
      let timer;
      let rejectDeadline;
      const deadline = new Promise((_resolve, reject) => {
        rejectDeadline = reject;
      });
      const cancel = () => {
        controller.abort();
        rejectDeadline(new Error('Synthetic GSI request cancelled'));
      };
      // The race is intentional: a broken custom fetch adapter may ignore
      // abort signals. We still must settle the desktop shutdown promptly.
      if (shutdown.signal.aborted) cancel();
      else shutdown.signal.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => {
        controller.abort();
        rejectDeadline(new Error('Synthetic GSI request timed out'));
      }, requestTimeoutMs);
      try {
        return await Promise.race([
          Promise.resolve().then(() => fetchImpl(url, { ...options, signal: controller.signal })),
          deadline,
        ]);
      } finally {
        clearTimeout(timer);
        shutdown.signal.removeEventListener('abort', cancel);
      }
    }
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
          const response = await timedFetch('http://127.0.0.1:' + receiver.port + '/gsi', {
            method: 'POST',
            headers: { 'content-type': 'application/json', connection: 'close' },
            body,
          });
          if (stopped) return;
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
      // Never enqueue additional updates while a local request is unresolved.
      if (updating || stopped) return;
      updating = true;
      pending = update().then(() => {
        if (!stopped) degraded = false;
      }).catch(() => {
        // Keep retrying at future ticks; an incomplete synthetic frame
        // cannot remain a healthy-looking public broadcast.
        if (!stopped) degraded = true;
      }).finally(() => { updating = false; });
    }, intervalMs);
    return {
      mode: 'demo',
      hudUrl: 'http://127.0.0.1:' + hud.port + '/',
      getStatus: () => ({
        mode: 'demo', connection: degraded ? 'interrupted' : 'synthetic', ageMs: null,
        diagnostics: summarizeConnection({
          mode: 'demo', connection: degraded ? 'interrupted' : 'synthetic', ageMs: null,
        }),
      }),
      getSettings: () => settings.get(),
      updateSettings: changes => settings.update(changes),
      async close() {
        if (stopped) return;
        stopped = true;
        if (timer !== null) clearInterval(timer);
        shutdown.abort();
        await pending;
        await overlay.close();
        await runtime.close();
      },
    };
  } catch (error) {
    stopped = true;
    if (timer !== null) clearInterval(timer);
    shutdown.abort();
    if (overlay) await overlay.close();
    await runtime.close();
    throw error;
  }
}
