import { randomUUID } from 'node:crypto';
import { createBroadcastRuntime } from '../../../services/engine/src/runtime.js';
import { createOverlayServer } from '../../../apps/overlay/src/server.js';
import { createPublicScoreboard } from '../../../apps/overlay/src/public-state.js';

const runtime = createBroadcastRuntime({
  matchId: process.env.ANOCORE_MATCH_ID,
  token: process.env.ANOCORE_GSI_TOKEN,
  sourceId: 'observer-1',
  delayMs: Number(process.env.ANOCORE_BROADCAST_DELAY_MS ?? 0),
  journalPath: process.env.ANOCORE_JOURNAL_PATH || undefined,
});
const address = await runtime.listen();
process.stdout.write(`GSI receiver and timeline listening on ${address.address}:${address.port}; run id ${randomUUID()}\n`);
const overlay = createOverlayServer({
  scoreboard: () => createPublicScoreboard(runtime.view()),
});
try {
  const ui = await overlay.listen();
  process.stdout.write(`OBS scoreboard: http://127.0.0.1:${ui.port}/\n`);
} catch (error) {
  await runtime.close();
  throw error;
}
