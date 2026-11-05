import { randomUUID } from 'node:crypto';
import { createBroadcastRuntime } from '../../../services/engine/src/runtime.js';
import { createOverlayServer } from '../../../apps/overlay/src/server.js';
import { createPublicScoreboard } from '../../../apps/overlay/src/public-state.js';
import { createBroadcastSettings } from '../../../apps/manager/src/settings.js';
import { createManagerServer } from '../../../apps/manager/src/server.js';

const runtime = createBroadcastRuntime({
  matchId: process.env.ANOCORE_MATCH_ID,
  token: process.env.ANOCORE_GSI_TOKEN,
  sourceId: 'observer-1',
  delayMs: Number(process.env.ANOCORE_BROADCAST_DELAY_MS ?? 0),
  journalPath: process.env.ANOCORE_JOURNAL_PATH || undefined,
});
const address = await runtime.listen();
process.stdout.write(`GSI receiver and timeline listening on ${address.address}:${address.port}; run id ${randomUUID()}\n`);
const settings = createBroadcastSettings();
const overlay = createOverlayServer({
  scoreboard: () => {
    const snapshot = createPublicScoreboard(runtime.view());
    const config = settings.get();
    return {
      ...snapshot,
      settings: config,
      players: config.showRoster ? snapshot.players : [],
    };
  },
});
try {
  const ui = await overlay.listen();
  process.stdout.write(`OBS scoreboard: http://127.0.0.1:${ui.port}/\n`);
} catch (error) {
  await runtime.close();
  throw error;
}

if (process.env.ANOCORE_ADMIN_TOKEN) {
  const manager = createManagerServer({
    token: process.env.ANOCORE_ADMIN_TOKEN, settings,
  });
  try {
    const admin = await manager.listen();
    process.stdout.write('Operator manager: http://127.0.0.1:' + admin.port + '/\n');
  } catch (error) {
    await overlay.close();
    await runtime.close();
    throw error;
  }
} else {
  process.stdout.write('Operator manager disabled: set ANOCORE_ADMIN_TOKEN (32+ bytes).\n');
}
