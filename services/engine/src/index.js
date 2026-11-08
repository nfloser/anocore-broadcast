import { validateEnvelope } from '../../../packages/protocol/src/index.js';

const MAX_PENDING = 64;
const DEFAULT_CAPACITY = 10_000;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function snapshotValid(payload) {
  // Reject invalid shapes early; only normalized observer snapshots are supported.
  if (!isRecord(payload) || !isRecord(payload.provider) ||
      !['Counter-Strike 2', 'Counter-Strike: Global Offensive'].includes(payload.provider.name)) return false;
  return ['map', 'round', 'player', 'bomb'].every(key =>
    payload[key] === undefined || isRecord(payload[key]));
}

function ensureNonnegativeInt(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid ${field}`);
}

/**
 * In-memory, deterministic observer snapshot timeline.
 *
 * A source has ordered, consecutive sequence numbers starting at 1.
 * Out-of-order inputs are buffered but never applied across gaps.
 * The read API is time-gated; it cannot expose snapshots newer than the
 * configured broadcast cutoff. The delay itself must be calibrated against video.
 */
export function createMatchTimeline({
  matchId,
  delayMs = 0,
  staleAfterMs = 5_000,
  capacity = DEFAULT_CAPACITY,
  retention = 'strict',
  clock = () => Date.now(),
  onCommit = () => {},
} = {}) {
  if (typeof matchId !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(matchId)) {
    throw new TypeError('Invalid matchId');
  }
  ensureNonnegativeInt(delayMs, 'delayMs');
  if (!['strict', 'rolling'].includes(retention)) throw new TypeError('Invalid retention mode');
  if (retention === 'rolling' && delayMs !== 0) {
    throw new TypeError('Rolling history cannot use a replay delay');
  }
  if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 1) {
    throw new TypeError('Invalid staleAfterMs');
  }
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new TypeError('Invalid capacity');
  }
  if (typeof clock !== 'function' || typeof onCommit !== 'function') throw new TypeError('Invalid clock or commit hook');

  const sources = new Map();
  const history = [];

  function source(id) {
    if (!sources.has(id)) sources.set(id, {
      lastSequence: 0, pending: new Map(), acceptedIds: new Set(),
    });
    return sources.get(id);
  }

  function ingest(event) {
    if (!validateEnvelope(event).ok || event.matchId !== matchId ||
        event.type !== 'observer.snapshot' || !snapshotValid(event.payload)) {
      return { status: 'invalid' };
    }

    const current = sources.get(event.sourceId);
    if (current?.acceptedIds.has(event.eventId) ||
        (current && event.sequence <= current.lastSequence) ||
        current?.pending.has(event.sequence) ||
        (current && [...current.pending.values()].some(item => item.eventId === event.eventId))) {
      return { status: 'duplicate' };
    }
    const state = current ?? source(event.sourceId);

    if (event.sequence > state.lastSequence + 1) {
      if (state.pending.size >= MAX_PENDING) return { status: 'backpressure' };
      state.pending.set(event.sequence, structuredClone(event));
      return { status: 'buffered', expected: state.lastSequence + 1 };
    }

    // Do not partially commit a run if the history has insufficient space.
    let available = 1;
    while (state.pending.has(event.sequence + available)) available++;
    if ((retention === 'strict' && history.length + available > capacity) ||
        (retention === 'rolling' && available > capacity)) {
      return { status: 'backpressure' };
    }

    const run = [structuredClone(event)];
    for (let sequence = event.sequence + 1; state.pending.has(sequence); sequence++) {
      run.push(state.pending.get(sequence));
    }
    // Persist the entire run before making it visible or acknowledging it.
    try {
      onCommit(structuredClone(run));
    } catch {
      return { status: 'persistence_error' };
    }
    // Only volatile zero-delay mode may discard old committed events. The
    // strict timeline keeps full replay/journal semantics and backpressure.
    if (retention === 'rolling') {
      const overflow = Math.max(0, history.length + run.length - capacity);
      for (const removed of history.splice(0, overflow)) {
        sources.get(removed.sourceId).acceptedIds.delete(removed.eventId);
      }
    }
    for (const item of run) {
      state.pending.delete(item.sequence);
      state.lastSequence = item.sequence;
      state.acceptedIds.add(item.eventId);
      history.push(item);
    }
    return { status: 'accepted', count: run.length };
  }

  function view(at = clock()) {
    ensureNonnegativeInt(at, 'view time');
    // Avoid returning snapshots from a previously observed later clock position:
    // callers may request historical views explicitly for tests/replays.
    const cutoff = Math.max(0, at - delayMs);
    const visible = new Map();
    for (const event of history) {
      if (event.occurredAt > cutoff) continue;
      const last = visible.get(event.sourceId);
      // Volatile zero-delay Live follows the latest committed source sequence.
      // Windows wall-clock corrections can make a newer acknowledged GSI
      // frame's occurredAt earlier than its predecessor. Strict history and
      // delayed replay retain their existing chronological timestamp order.
      const newer = retention === 'rolling' ?
        event.sequence > (last?.sequence ?? 0) :
        !last || event.occurredAt > last.occurredAt ||
          (event.occurredAt === last.occurredAt && event.sequence > last.sequence);
      if (newer) visible.set(event.sourceId, event);
    }
    const snapshots = {};
    const freshness = {};
    for (const [id, state] of sources) {
      const event = visible.get(id);
      const ageMs = event ? Math.max(0, cutoff - event.occurredAt) : null;
      const status = event === undefined ? 'waiting' :
        ageMs > staleAfterMs || state.pending.size > 0 ? 'stale' : 'live';
      freshness[id] = { status, ageMs, lastSequence: state.lastSequence,
        pending: state.pending.size };
      // Never render a stale snapshot as if it were live.
      if (status === 'live') snapshots[id] = structuredClone(event.payload);
    }
    return { matchId, at, cutoff, snapshots, freshness };
  }

  function stats() {
    return { eventCount: history.length, sources: sources.size, capacity };
  }

  function lastSequence(sourceId) {
    return sources.get(sourceId)?.lastSequence ?? 0;
  }

  return { ingest, view, stats, lastSequence };
}
