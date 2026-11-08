import assert from 'node:assert/strict';
import test from 'node:test';
import { createBroadcastRuntime } from '../src/runtime.js';

const token = 'test-secret-0123456789';
function snapshot(round = 1) {
  return {
    auth: { token },
    provider: { name: 'Counter-Strike 2', timestamp: 1793900000 },
    map: { name: 'de_inferno', round, phase: 'live',
      team_ct: { score: 7 }, team_t: { score: 5 } },
    player: { name: 'Observer', team: 'CT', state: { health: 100 } },
  };
}

async function serve(options, t) {
  const runtime = createBroadcastRuntime({
    matchId: 'match-1', token, port: 0, ...options,
  });
  const address = await runtime.listen();
  t.after(() => runtime.close());
  return { runtime, url: `http://127.0.0.1:${address.port}/gsi` };
}

test('HTTP GSI snapshots pass through engine and respect the delayed read cutoff', async (t) => {
  let now = 10_000;
  const { runtime, url } = await serve({
    clock: () => now, delayMs: 1000, staleAfterMs: 10_000,
  }, t);

  const first = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(snapshot()),
  });
  assert.equal(first.status, 202);
  assert.equal(runtime.stats().eventCount, 1);
  assert.equal(runtime.view(10_999).freshness['observer-1'].status, 'waiting');
  assert.equal(runtime.view(10_999).snapshots['observer-1'], undefined);
  assert.equal(runtime.view(11_000).snapshots['observer-1'].map.name, 'de_inferno');

  now = 12_000;
  const second = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(snapshot(2)),
  });
  assert.equal(second.status, 202);
  assert.equal(runtime.view(12_999).snapshots['observer-1'].map.round, 1);
  assert.equal(runtime.view(13_000).snapshots['observer-1'].map.round, 2);
});

test('unauthorized or malformed POSTs never reach the match timeline', async (t) => {
  const { runtime, url } = await serve({}, t);
  const forbidden = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...snapshot(), auth: { token: 'incorrect' } }),
  });
  assert.equal(forbidden.status, 401);
  const malformed = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: '{bad',
  });
  assert.equal(malformed.status, 400);
  assert.equal(runtime.stats().eventCount, 0);
  assert.equal(runtime.freshness().status, 'waiting');
});

test('engine capacity rejection returns 503 and does not advance accepted sequence', async (t) => {
  let now = 1000;
  const { runtime, url } = await serve({
    capacity: 1, clock: () => now, staleAfterMs: 10_000,
  }, t);
  const post = async round => fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(snapshot(round)),
  });
  assert.equal((await post(1)).status, 202);
  now = 2000;
  assert.equal((await post(2)).status, 503);
  assert.equal(runtime.stats().eventCount, 1);
  assert.equal(runtime.freshness().lastReceivedAt, 1000);
  assert.equal((await post(3)).status, 503);
  assert.equal(runtime.view(2000).freshness['observer-1'].lastSequence, 1);
});

test('stale snapshots are omitted after disconnect and never returned as live', async (t) => {
  let now = 1000;
  const { runtime, url } = await serve({
    clock: () => now, staleAfterMs: 1000,
  }, t);
  assert.equal((await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(snapshot()),
  })).status, 202);
  assert.equal(runtime.view().freshness['observer-1'].status, 'live');
  now = 2001;
  assert.equal(runtime.freshness().status, 'stale');
  assert.equal(runtime.view().freshness['observer-1'].status, 'stale');
  assert.equal(runtime.view().snapshots['observer-1'], undefined);
});

test('invalid startup parameters fail before binding a receiver', () => {
  assert.throws(() => createBroadcastRuntime({
    matchId: 'match-1', token: 'short',
  }), /token/);
  assert.throws(() => createBroadcastRuntime({
    matchId: 'match-1', token, host: '0.0.0.0',
  }), /loopback/);
  assert.throws(() => createBroadcastRuntime({
    matchId: 'match-1', token, delayMs: -1,
  }), /delayMs/);
});

test('volatile rolling local GSI receiver keeps accepting verified snapshots after memory capacity', async t => {
  let now = 1000;
  const { runtime, url } = await serve({
    retention: 'rolling', capacity: 2, clock: () => now, staleAfterMs: 10000,
  }, t);
  for (let round = 1; round <= 8; round++) {
    now += 100;
    const response = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(snapshot(round)),
    });
    assert.equal(response.status, 202, 'round ' + round + ' unexpectedly rejected');
    assert.equal(runtime.stats().eventCount, Math.min(round, 2));
  }
  assert.equal(runtime.view().snapshots['observer-1'].map.round, 8);
  assert.equal(runtime.view().freshness['observer-1'].lastSequence, 8);
  assert.equal(runtime.freshness().status, 'live');
});

test('persistent journals cannot use rolling timeline retention', () => {
  assert.throws(() => createBroadcastRuntime({
    matchId: 'match-1', token, journalPath: '/tmp/unused-test-journal.jsonl',
    retention: 'rolling',
  }), /rolling.*journal/i);
  assert.throws(() => createBroadcastRuntime({
    matchId: 'match-1', token, delayMs: 1000, retention: 'rolling',
  }), /rolling.*delay/i);
});
