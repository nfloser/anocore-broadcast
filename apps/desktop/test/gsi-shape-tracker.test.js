import assert from 'node:assert/strict';
import test from 'node:test';
import { createSafeGsiShapeTracker } from '../src/gsi-shape-tracker.js';

test('64-entry GSI field-shape window expires oldest samples without retaining raw values', () => {
  const tracker = createSafeGsiShapeTracker();
  const secret = 'private-map-and-token-0123';
  tracker.accept({ map: true, allplayers: true, emptyAllplayers: true,
    previously: true, secret, auth: { token: secret }, providerId: '76561190000' });
  const initial = tracker.summary();
  assert.equal(initial.samples, 1);
  assert.equal(initial.totalAccepted, 1);
  assert.equal(initial.fields.map, 1);
  assert.equal(initial.fields.emptyAllplayers, 1);
  assert.equal(initial.fields.completeScoreboard, 0);
  assert.equal(initial.fields.nonemptyAllplayers, 0);
  for (let i = 0; i < 64; i++) {
    tracker.accept({ round: true, added: true, allplayers: false });
  }
  const result = tracker.summary();
  assert.equal(result.windowSize, 64);
  assert.equal(result.samples, 64);
  assert.equal(result.totalAccepted, 65);
  assert.equal(result.fields.map, 0);
  assert.equal(result.fields.completeScoreboard, 0);
  assert.equal(result.fields.nonemptyAllplayers, 0);
  assert.equal(result.fields.emptyAllplayers, 0);
  assert.equal(result.fields.previously, 0);
  assert.equal(result.fields.round, 64);
  assert.equal(result.fields.added, 64);
  const json = JSON.stringify(result);
  for (const value of [secret, '7656119', 'providerId', 'auth']) {
    assert.equal(json.includes(value), false);
  }
});

test('shape summary allows only true booleans and cannot be mutated by caller', () => {
  const tracker = createSafeGsiShapeTracker();
  tracker.accept({ map: 'de_secret', round: 1, allplayers: true, added: true,
    completeScoreboard: 'yes', nonemptyAllplayers: 1 });
  const result = tracker.summary();
  assert.equal(result.fields.map, 0);
  assert.equal(result.fields.round, 0);
  assert.equal(result.fields.allplayers, 1);
  assert.equal(result.fields.completeScoreboard, 0);
  assert.equal(result.fields.nonemptyAllplayers, 0);
  result.fields.allplayers = 900;
  assert.equal(tracker.summary().fields.allplayers, 1);
});
