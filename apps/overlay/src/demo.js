import { randomBytes } from 'node:crypto';
import { createBroadcastRuntime } from '../../../services/engine/src/runtime.js';
import { createPublicScoreboard } from './public-state.js';
import { createOverlayServer } from './server.js';
import { createDemoFrame } from './demo-fixture.js';
import { createBroadcastSettings } from '../../manager/src/settings.js';
import { createManagerServer } from '../../manager/src/server.js';

const token = randomBytes(32).toString('hex');
const runtime = createBroadcastRuntime({
  matchId: 'demo-match', token, port: 3008, staleAfterMs: 15000,
});
const receiver = await runtime.listen();
const settings = createBroadcastSettings({
  filePath: process.env.ANOCORE_MANAGER_CONFIG_PATH || undefined,
});
const overlay = createOverlayServer({
  port: 3009,
  scoreboard: () => {
    const state = createPublicScoreboard(runtime.view());
    const config = settings.get();
    return {
      ...state, demo: true, settings: config,
      players: config.showRoster ? state.players : [],
    };
  },
});
try {
  await overlay.listen();
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
    process.stdout.write('Demo operator manager: http://127.0.0.1:' + admin.port + '/\\n');
  } catch (error) {
    await overlay.close();
    await runtime.close();
    throw error;
  }
}
let step = 0;
async function update() {
  const response = await fetch('http://127.0.0.1:' + receiver.port + '/gsi', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(createDemoFrame(step++, token)),
  });
  if (!response.ok) {
    throw new Error('Demo ingest returned HTTP ' + response.status);
  }
}
try {
  await update();
} catch (error) {
  await overlay.close();
  await runtime.close();
  throw error;
}
process.stdout.write('AnoCore Broadcast DEMO: http://127.0.0.1:3009/\n');
process.stdout.write('Synthetic test data only. Press Ctrl+C to stop.\n');
const interval = setInterval(() => {
  update().catch(error => {
    process.stderr.write('Demo update failed: ' + error.message + '\n');
    clearInterval(interval);
  });
}, 2000);
