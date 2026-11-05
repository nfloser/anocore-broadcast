import assert from 'node:assert/strict';
import test from 'node:test';
import { PROTOCOL_VERSION, validateEnvelope } from '../src/index.js';

const valid = () => ({
  version: PROTOCOL_VERSION,
  eventId: 'event-1',
  matchId: 'match-123',
  sourceId: 'observer-1',
  type: 'round.started',
  sequence: 0,
  occurredAt: 1793900000000,
  tick: 42,
  payload: { round: 1 },
});

test('valid envelope is accepted without modifying it', () => {
  const envelope = valid();
  const original = structuredClone(envelope);
  assert.deepEqual(validateEnvelope(envelope), { ok: true, errors: [] });
  assert.deepEqual(envelope, original);
});

test('null, arrays and primitive inputs are rejected', () => {
  for (const value of [null, [], 'text', 5, false]) {
    assert.equal(validateEnvelope(value).ok, false);
  }
});

test('rejects version mismatch', () => {
  assert.equal(validateEnvelope({ ...valid(), version: 2 }).ok, false);
});

test('rejects malformed event identifiers and type', () => {
  assert.equal(validateEnvelope({ ...valid(), eventId: '../abc' }).ok, false);
  assert.equal(validateEnvelope({ ...valid(), type: 'Round Started' }).ok, false);
});

test('rejects invalid sequence, tick and timestamp', () => {
  for (const changed of [
    { sequence: -1 }, { sequence: 1.1 }, { tick: -1 },
    { occurredAt: NaN }, { occurredAt: -1 }, { occurredAt: Infinity },
  ]) {
    assert.equal(validateEnvelope({ ...valid(), ...changed }).ok, false);
  }
});

test('rejects payload arrays and unknown envelope fields', () => {
  assert.equal(validateEnvelope({ ...valid(), payload: [] }).ok, false);
  assert.equal(validateEnvelope({ ...valid(), token: 'secret' }).ok, false);
});

test('accepts optional absent tick', () => {
  const envelope = valid();
  delete envelope.tick;
  assert.equal(validateEnvelope(envelope).ok, true);
});
