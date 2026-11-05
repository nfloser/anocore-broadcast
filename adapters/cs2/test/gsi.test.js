import assert from 'node:assert/strict';
import test from 'node:test';
import { createGsiIngest, createGsiServer, normalizeGsiSnapshot } from '../src/index.js';

const token = 'test-secret-0123456789';
const fixture = () => ({
  auth: { token },
  provider: { name: 'Counter-Strike 2', timestamp: 1793900000 },
  map: { name: 'de_inferno', phase: 'live', round: 12,
    team_ct: { score: 7 }, team_t: { score: 5 } },
  round: { phase: 'live' },
  player: { steamid: '76561198000000000', name: 'Player', team: 'CT',
    state: { health: 82, armor: 100, money: 3200 } },
});

test('normalizes only permitted fields and does not leak authentication data', () => {
  const payload = normalizeGsiSnapshot(fixture());
  assert.equal(payload.map.ctScore, 7);
  assert.equal(payload.player.state.health, 82);
  assert.equal(JSON.stringify(payload).includes(token), false);
  assert.deepEqual(payload.map, { name: 'de_inferno', phase: 'live',
    round: 12, ctScore: 7, tScore: 5 });
});

test('rejects unexpected providers and malformed snapshots', () => {
  for (const input of [null, {}, { provider: { name: 'other' } }]) {
    assert.throws(() => normalizeGsiSnapshot(input));
  }
});

test('rejects missing or incorrect token without changing freshness', () => {
  const events = [];
  const ingest = createGsiIngest({ matchId: 'match-1', token, onEvent: (e) => events.push(e) });
  assert.equal(ingest.accept({ ...fixture(), auth: {} }).status, 401);
  assert.equal(ingest.accept({ ...fixture(), auth: { token: 'wrong' } }).status, 401);
  assert.equal(ingest.freshness().status, 'waiting');
  assert.equal(events.length, 0);
});

test('tracks sequence, source, freshness and replays fixture deterministically', () => {
  let now = 1000;
  const events = [];
  const ingest = createGsiIngest({ matchId: 'match-1', token, clock: () => now,
    staleAfterMs: 1000, onEvent: (e) => events.push(e) });
  assert.equal(ingest.accept(fixture()).status, 202);
  assert.equal(ingest.accept(fixture()).status, 202);
  assert.deepEqual(events.map((e) => e.sequence), [1, 2]);
  assert.equal(events[0].type, 'observer.snapshot');
  assert.equal(events[0].matchId, 'match-1');
  assert.equal(ingest.freshness().status, 'live');
  now = 2001;
  assert.equal(ingest.freshness().status, 'stale');
});

test('failed consumer does not advance accepted event sequence', () => {
  let fail = true;
  const events = [];
  const ingest = createGsiIngest({ matchId: 'match-1', token,
    onEvent: e => { if (fail) throw Error('offline'); events.push(e); } });
  assert.equal(ingest.accept(fixture()).status, 503);
  assert.equal(ingest.freshness().status, 'waiting');
  fail = false;
  assert.equal(ingest.accept(fixture()).status, 202);
  assert.equal(events[0].sequence, 1);
});

test('server only binds to loopback and requires a valid shared secret', () => {
  const ingest = createGsiIngest({ matchId: 'match-1', token });
  assert.throws(() => createGsiServer(ingest, { host: '0.0.0.0' }));
  assert.throws(() => createGsiIngest({ matchId: 'match-1', token: 'short' }));
});

test('HTTP handles valid payload, malformed JSON, access control and stale status', async (t) => {
  let now = 1000;
  const events = [];
  const ingest = createGsiIngest({ matchId: 'match-1', token, clock: () => now,
    staleAfterMs: 1000, onEvent: (e) => events.push(e) });
  const instance = createGsiServer(ingest, { port: 0 });
  const address = await instance.listen();
  t.after(() => new Promise(resolve => instance.server.close(resolve)));
  const base = `http://127.0.0.1:${address.port}`;
  async function post(body, headers = { 'content-type': 'application/json' }) {
    return fetch(`${base}/gsi`, { method: 'POST', headers, body });
  }
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal((await post('{bad')).status, 400);
  assert.equal((await post(JSON.stringify(fixture()), { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post(JSON.stringify({ ...fixture(), auth: { token: 'bad' } }))).status, 401);
  assert.equal((await post(JSON.stringify(fixture()))).status, 202);
  assert.equal(events.length, 1);
  now = 3000;
  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.status, 'stale');
  assert.equal((await post(' '.repeat(256 * 1024 + 1))).status, 413);
});
