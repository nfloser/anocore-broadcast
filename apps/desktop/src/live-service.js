import { randomBytes } from 'node:crypto';
import { createBroadcastRuntime } from '../../../services/engine/src/runtime.js';
import { createPublicScoreboard } from '../../overlay/src/public-state.js';
import { createOverlayServer } from '../../overlay/src/server.js';
import { createBroadcastSettings } from '../../manager/src/settings.js';
import { createObserverConfig } from './gsi-config.js';

/**
 * Desktop main-process-only observer service. The live mode does not simulate
 * GSI, invent radar markers or transfer credentials to a browser renderer.
 */
export async function startDesktopLive({
  receiverPort = 3008,
  overlayPort = 3009,
  settingsPath,
  matchId = 'desktop-live',
  token = randomBytes(32).toString('hex'),
  clock,
  staleAfterMs = 5000,
} = {}) {
  const settings = createBroadcastSettings({ filePath: settingsPath });
  // Validate config before acquiring any network listener.
  // The auth key remains in this main-process service; the GSI config is
  // available only through its privileged, explicit export command.
  createObserverConfig({ token, port: receiverPort === 0 ? 3008 : receiverPort });
  const runtime = createBroadcastRuntime({
    matchId, token, port: receiverPort, clock, staleAfterMs,
  });
  let overlay = null;
  let closed = false;
  try {
    const receiver = await runtime.listen();
    const gsiConfig = createObserverConfig({ token, port: receiver.port });
    overlay = createOverlayServer({
      port: overlayPort,
      scoreboard: () => {
        const state = createPublicScoreboard(runtime.view());
        const config = settings.get();
        return {
          ...state,
          settings: config,
          players: config.showRoster ? state.players : [],
        };
      },
    });
    const hud = await overlay.listen();
    return {
      mode: 'live',
      hudUrl: 'http://127.0.0.1:' + hud.port + '/',
      gsiUrl: 'http://127.0.0.1:' + receiver.port + '/gsi',
      getGsiConfig: () => gsiConfig,
      getSettings: () => settings.get(),
      updateSettings: changes => settings.update(changes),
      getStatus: () => {
        const { status, ageMs } = runtime.freshness();
        return { mode: 'live', connection: status, ageMs };
      },
      async close() {
        if (closed) return;
        closed = true;
        await overlay.close();
        await runtime.close();
      },
    };
  } catch (error) {
    closed = true;
    if (overlay) await overlay.close();
    await runtime.close();
    throw error;
  }
}
