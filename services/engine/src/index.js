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
  clock = () => Date.now(),
  onCommit = () => {},
} = {}) {
  if (typeof matchId !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/.test(matchId)) {
    throw new TypeError('Invalid matchId');
  }
  ensureNonnegativeInt(delayMs, 'delayMs');
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
    if (history.length + available > capacity) return { status: 'backpressure' };

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
      if (!last || event.occurredAt > last.occurredAt ||
          (event.occurredAt === last.occurredAt && event.sequence > last.sequence)) {
        visible.set(event.sourceId, event);
      }
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
