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

test('aggregate GSI transitions distinguish alternating partial frames from a long gap', () => {
  const tracker = createSafeGsiShapeTracker();
  const sample = (completeScoreboard, nonemptyAllplayers) => {
    tracker.accept({ completeScoreboard, nonemptyAllplayers });
  };
  sample(true, true);
  sample(false, false);
  sample(false, false);
  sample(true, true);
  sample(false, true);
  const result = tracker.summary();
  assert.deepEqual(result.transitions, {
    scoreboardBecameIncomplete: 2,
    scoreboardBecameComplete: 1,
    rosterBecameMissing: 1,
    rosterBecameNonempty: 1,
    longestIncompleteScoreboardStreak: 2,
  });
  result.transitions.scoreboardBecameIncomplete = 999;
  assert.equal(tracker.summary().transitions.scoreboardBecameIncomplete, 2);
});

test('rollover excludes evicted transitions and does not infer frames outside the window', () => {
  const tracker = createSafeGsiShapeTracker();
  tracker.accept({ completeScoreboard: true, nonemptyAllplayers: true });
  for (let i = 0; i < 64; i++) {
    tracker.accept({ completeScoreboard: false, nonemptyAllplayers: false });
  }
  const result = tracker.summary();
  assert.equal(result.samples, 64);
  assert.equal(result.totalAccepted, 65);
  assert.deepEqual(result.transitions, {
    scoreboardBecameIncomplete: 0,
    scoreboardBecameComplete: 0,
    rosterBecameMissing: 0,
    rosterBecameNonempty: 0,
    longestIncompleteScoreboardStreak: 64,
  });
  assert.deepEqual(createSafeGsiShapeTracker().summary().transitions, {
    scoreboardBecameIncomplete: 0,
    scoreboardBecameComplete: 0,
    rosterBecameMissing: 0,
    rosterBecameNonempty: 0,
    longestIncompleteScoreboardStreak: 0,
  });
});
