import { createGsiIngest, createGsiServer } from '../../../adapters/cs2/src/index.js';
import { createMatchTimeline } from './index.js';

/**
 * Assemble the local observer ingest and in-memory broadcast timeline.
 *
 * The returned view() is in-process only. An authenticated, role-scoped
 * public-facing API must be designed separately; never expose this raw
 * observer state directly to players or browser overlays.
 */
export function createBroadcastRuntime({
  matchId,
  token,
  sourceId = 'observer-1',
  delayMs = 0,
  staleAfterMs = 5_000,
  capacity = 10_000,
  clock = () => Date.now(),
  host = '127.0.0.1',
  port = 3008,
} = {}) {
  const timeline = createMatchTimeline({
    matchId, delayMs, staleAfterMs, capacity, clock,
  });

  const ingest = createGsiIngest({
    matchId, sourceId, token, staleAfterMs, clock,
    onEvent(event) {
      const result = timeline.ingest(event);
      // The receiver only acknowledges an event if the engine committed it.
      // The ingest sequence is then retried rather than silently advancing.
      if (result.status !== 'accepted') {
        throw new Error('Timeline rejected the observer event');
      }
    },
  });

  const receiver = createGsiServer(ingest, { host, port });
  return {
    listen: receiver.listen,
    close: () => new Promise((resolve, reject) => {
      receiver.server.close(error => error ? reject(error) : resolve());
    }),
    view: (at) => timeline.view(at),
    stats: () => timeline.stats(),
    freshness: () => ingest.freshness(),
  };
}
