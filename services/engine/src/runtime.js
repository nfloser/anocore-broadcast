import { createGsiIngest, createGsiServer } from '../../../adapters/cs2/src/index.js';
import { createMatchTimeline } from './index.js';
import { createEventJournal } from './journal.js';

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
  retention = 'strict',
  clock = () => Date.now(),
  host = '127.0.0.1',
  port = 3008,
  bodyTimeoutMs = 5_000,
  journalPath,
  maxJournalBytes = 32 * 1024 * 1024,
  onAcceptedShape,
} = {}) {
  if (retention === 'rolling' && journalPath !== undefined) {
    throw new TypeError('Rolling retention is incompatible with journal persistence');
  }
  // No file is created unless persistence is explicitly configured.
  const journal = journalPath === undefined ? null :
    createEventJournal({ filePath: journalPath, maxBytes: maxJournalBytes });
  let recovering = true;
  const timeline = createMatchTimeline({
    matchId, delayMs, staleAfterMs, capacity, retention, clock,
    onCommit: events => { if (!recovering) journal?.append(events); },
  });
  if (journal) {
    // Strict recovery: any corrupted/truncated record or wrong match aborts
    // startup instead of exposing a partially reconstructed match as valid.
    for (const event of journal.read()) {
      const result = timeline.ingest(event);
      if (result.status !== 'accepted' || result.count !== 1) {
        throw new Error('Journal recovery failed: invalid event sequence or match');
      }
    }
  }

  recovering = false;

  const ingest = createGsiIngest({
    matchId, sourceId, token, staleAfterMs, clock,
    initialSequence: timeline.lastSequence(sourceId),
    onAcceptedShape,
    onEvent(event) {
      const result = timeline.ingest(event);
      // The receiver only acknowledges an event if the engine committed it.
      // The ingest sequence is then retried rather than silently advancing.
      if (result.status !== 'accepted') {
        throw new Error('Timeline rejected the observer event');
      }
    },
  });

  const receiver = createGsiServer(ingest, { host, port, bodyTimeoutMs });
  return {
    listen: receiver.listen,
    close: receiver.close,
    view: (at) => timeline.view(at),
    stats: () => timeline.stats(),
    freshness: () => ingest.freshness(),
    journalEnabled: journal !== null,
    checkpoint: () => {
      if (!journal) throw new Error('Journal is disabled');
      return journal.checkpoint();
    },
  };
}
