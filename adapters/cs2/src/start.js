import { randomUUID } from 'node:crypto';
import { createBroadcastRuntime } from '../../../services/engine/src/runtime.js';

const runtime = createBroadcastRuntime({
  matchId: process.env.ANOCORE_MATCH_ID,
  token: process.env.ANOCORE_GSI_TOKEN,
  sourceId: 'observer-1',
  delayMs: Number(process.env.ANOCORE_BROADCAST_DELAY_MS ?? 0),
});
const address = await runtime.listen();
process.stdout.write(`GSI receiver and timeline listening on ${address.address}:${address.port}; run id ${randomUUID()}\n`);
process.stdout.write('Read-only timeline is currently available in-process only; no broadcast-facing HTTP endpoint is exposed.\n');
