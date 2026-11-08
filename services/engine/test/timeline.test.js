import assert from 'node:assert/strict';
import test from 'node:test';
import { createMatchTimeline } from '../src/index.js';

const packet = (sequence, at = 1000, sourceId = 'observer-1', mapName = 'de_inferno') => ({
  version: 1, matchId: 'match-1', sourceId, eventId: `${sourceId}:${sequence}`,
  sequence, occurredAt: at, type: 'observer.snapshot',
  payload: { provider: { name: 'Counter-Strike 2' }, map: { name: mapName, round: sequence } },
});

test('validates envelopes and isolates match IDs', () => {
  const engine = createMatchTimeline({ matchId: 'match-1' });
  assert.equal(engine.ingest({ ...packet(1), matchId: 'other' }).status, 'invalid');
  assert.equal(engine.ingest({ ...packet(1), payload: [] }).status, 'invalid');
  assert.equal(engine.stats().eventCount, 0);
  assert.equal(engine.ingest(packet(1)).status, 'accepted');
});

test('buffers reordered events without skipping sequence gaps', () => {
  const engine = createMatchTimeline({ matchId: 'match-1' });
  assert.deepEqual(engine.ingest(packet(2)), { status: 'buffered', expected: 1 });
  assert.equal(engine.view(2000).snapshots['observer-1'], undefined);
  assert.deepEqual(engine.ingest(packet(1)), { status: 'accepted', count: 2 });
  assert.equal(engine.view(2000).snapshots['observer-1'].map.round, 2);
});

test('rejects replayed and conflicting sequence values', () => {
  const engine = createMatchTimeline({ matchId: 'match-1' });
  assert.equal(engine.ingest(packet(1)).status, 'accepted');
  assert.equal(engine.ingest(packet(1)).status, 'duplicate');
  assert.equal(engine.ingest({ ...packet(1), eventId: 'different' }).status, 'duplicate');
  assert.equal(engine.stats().eventCount, 1);
});

test('holds future data until broadcast cutoff and handles old events correctly', () => {
  const engine = createMatchTimeline({
    matchId: 'match-1', delayMs: 5_000, staleAfterMs: 30_000,
  });
  engine.ingest(packet(1, 10_000, 'observer-1', 'de_inferno'));
  engine.ingest(packet(2, 12_000, 'observer-1', 'de_nuke'));
  assert.equal(engine.view(14_999).freshness['observer-1'].status, 'waiting');
  assert.equal(engine.view(15_000).snapshots['observer-1'].map.name, 'de_inferno');
  assert.equal(engine.view(16_999).snapshots['observer-1'].map.name, 'de_inferno');
  assert.equal(engine.view(17_000).snapshots['observer-1'].map.name, 'de_nuke');
  assert.equal(engine.view(15_000).snapshots['observer-1'].map.name, 'de_inferno');
});

test('marks stale sources and suppresses stale snapshots', () => {
  const engine = createMatchTimeline({ matchId: 'match-1', staleAfterMs: 1000 });
  engine.ingest(packet(1, 1000));
  assert.equal(engine.view(2000).freshness['observer-1'].status, 'live');
  assert.equal(engine.view(2001).freshness['observer-1'].status, 'stale');
  assert.equal(engine.view(2001).snapshots['observer-1'], undefined);
});

test('returns safe independent snapshots and separates sources', () => {
  const engine = createMatchTimeline({ matchId: 'match-1', staleAfterMs: 100_000 });
  const first = packet(1);
  engine.ingest(first);
  first.payload.map.name = 'mutated';
  engine.ingest(packet(1, 1100, 'observer-2', 'de_mirage'));
  const output = engine.view(1500);
  assert.equal(output.snapshots['observer-1'].map.name, 'de_inferno');
  assert.equal(output.snapshots['observer-2'].map.name, 'de_mirage');
  output.snapshots['observer-1'].map.name = 'changed';
  assert.equal(engine.view(1500).snapshots['observer-1'].map.name, 'de_inferno');
});

test('keeps sequence gap visibly degraded', () => {
  const engine = createMatchTimeline({ matchId: 'match-1', staleAfterMs: 100_000 });
  engine.ingest(packet(1));
  engine.ingest(packet(3, 1500));
  assert.equal(engine.view(1600).freshness['observer-1'].status, 'stale');
  assert.equal(engine.view(1600).snapshots['observer-1'], undefined);
  assert.equal(engine.ingest(packet(2, 1400)).status, 'accepted');
  assert.equal(engine.view(1600).freshness['observer-1'].status, 'live');
});

test('backpressure keeps history bounded without losing contiguous state', () => {
  const engine = createMatchTimeline({ matchId: 'match-1', capacity: 1 });
  assert.equal(engine.ingest(packet(1)).status, 'accepted');
  assert.equal(engine.ingest(packet(2)).status, 'backpressure');
  assert.equal(engine.stats().eventCount, 1);
});

test('rejects negative delay and malformed engine options', () => {
  assert.throws(() => createMatchTimeline({ matchId: 'match-1', delayMs: -1 }));
  assert.throws(() => createMatchTimeline({ matchId: 'match-1', staleAfterMs: 0 }));
  assert.throws(() => createMatchTimeline({ matchId: '' }));
});

test('rejects repeated event IDs while events are still buffered', () => {
  const engine = createMatchTimeline({ matchId: 'match-1' });
  assert.equal(engine.ingest(packet(3)).status, 'buffered');
  assert.equal(engine.ingest({ ...packet(2), eventId: 'observer-1:3' }).status, 'duplicate');
  assert.equal(engine.ingest(packet(2)).status, 'buffered');
  assert.equal(engine.ingest(packet(1)).status, 'accepted');
  assert.equal(engine.stats().eventCount, 3);
});

test('accepts the legacy-labelled CS2 GSI provider', () => {
  const engine = createMatchTimeline({ matchId: 'match-1' });
  const event = packet(1);
  event.payload.provider.name = 'Counter-Strike: Global Offensive';
  assert.equal(engine.ingest(event).status, 'accepted');
});

test('volatile zero-delay history accepts updates after capacity and rejects old sequence replays', () => {
  const engine = createMatchTimeline({
    matchId: 'match-1', retention: 'rolling', capacity: 3,
    clock: () => 5000, staleAfterMs: 10000,
  });
  for (let sequence = 1; sequence <= 12; sequence++) {
    assert.deepEqual(engine.ingest(packet(sequence, 1000 + sequence)), {
      status: 'accepted', count: 1,
    });
    assert.equal(engine.stats().eventCount, Math.min(3, sequence));
  }
  assert.equal(engine.view().snapshots['observer-1'].map.round, 12);
  assert.equal(engine.view(1003).snapshots['observer-1'], undefined,
    'Evicted historical views must not silently reconstruct prior state');
  assert.equal(engine.lastSequence('observer-1'), 12);
  assert.equal(engine.ingest(packet(1, 1001)).status, 'duplicate');
  assert.equal(engine.ingest({ ...packet(5), eventId: 'another-id' }).status, 'duplicate');
  assert.equal(engine.stats().eventCount, 3);
});

test('volatile retention preserves per-source sequence gaps and freshness', () => {
  const engine = createMatchTimeline({
    matchId: 'match-1', retention: 'rolling', capacity: 2,
    clock: () => 5000, staleAfterMs: 10000,
  });
  assert.equal(engine.ingest(packet(1, 1000)).status, 'accepted');
  assert.equal(engine.ingest(packet(2, 1001, 'observer-2')).status, 'buffered');
  assert.equal(engine.view().freshness['observer-2'].status, 'waiting');
  assert.deepEqual(engine.ingest(packet(1, 1002, 'observer-2')), {
    status: 'accepted', count: 2,
  });
  assert.equal(engine.stats().eventCount, 2);
  assert.equal(engine.view().snapshots['observer-1'], undefined);
  assert.equal(engine.view().snapshots['observer-2'].map.round, 2);
  assert.equal(engine.lastSequence('observer-1'), 1);
  assert.equal(engine.lastSequence('observer-2'), 2);
  assert.equal(engine.ingest(packet(1, 1000)).status, 'duplicate');
});

test('rolling mode is explicit and incompatible with replay delay', () => {
  assert.throws(() => createMatchTimeline({ matchId: 'match-1', retention: 'missing' }), /retention/i);
  assert.throws(() => createMatchTimeline({ matchId: 'match-1', retention: 'rolling', delayMs: 1 }), /rolling.*delay/i);
  const strict = createMatchTimeline({ matchId: 'match-1', capacity: 1 });
  assert.equal(strict.ingest(packet(1)).status, 'accepted');
  assert.equal(strict.ingest(packet(2)).status, 'backpressure');
});
