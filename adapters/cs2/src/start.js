import { randomUUID } from 'node:crypto';
import { createGsiIngest, createGsiServer } from './index.js';

const token = process.env.ANOCORE_GSI_TOKEN;
const matchId = process.env.ANOCORE_MATCH_ID;
const ingest = createGsiIngest({
  matchId,
  token,
  sourceId: 'observer-1',
  onEvent: (event) => {
    // Deliberately log only a concise envelope summary, not private player data.
    process.stdout.write(JSON.stringify({
      eventId: event.eventId, matchId: event.matchId,
      type: event.type, occurredAt: event.occurredAt,
    }) + '\n');
  },
});
const receiver = createGsiServer(ingest);
const address = await receiver.listen();
process.stdout.write(`GSI receiver listening on ${address.address}:${address.port}; run id ${randomUUID()}\n`);
