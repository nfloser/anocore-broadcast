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
