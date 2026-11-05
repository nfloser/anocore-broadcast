import assert from 'node:assert/strict';
import test from 'node:test';
import { createGsiIngest, createGsiServer, normalizeGsiSnapshot, parseSpectatorVector } from '../src/index.js';

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

test('rejects source identifiers that cannot fit into envelope event IDs', () => {
  assert.throws(() => createGsiIngest({ matchId: 'match-1', sourceId: 's'.repeat(110), token }));
});

test('bounds and normalizes spectator roster without leaking Steam IDs', () => {
  const raw = fixture();
  raw.allplayers = {
    '76561198000000001': {
      name: '<script>ignored</script>', team: 'CT', observer_slot: 3,
      state: { health: 70, armor: 96, money: 2700, secret: 'not allowed' },
      match_stats: { kills: 21, assists: 4, deaths: 12, damage: 9000 },
    },
    '76561198000000002': { name: 'Second', team: 'T', state: { health: -10 } },
    spectator: { team: 'SPEC', name: 'Spectator' },
  };
  const projected = normalizeGsiSnapshot(raw);
  assert.equal(projected.players.length, 2);
  assert.deepEqual(projected.players[0], {
    team: 'CT', name: '<script>ignored</script>', slot: 3,
    health: 70, armor: 96, money: 2700, kills: 21, assists: 4, deaths: 12,
  });
  assert.equal(projected.players[1].health, undefined);
  assert.equal(JSON.stringify(projected).includes('76561198000000001'), false);
  assert.equal(JSON.stringify(projected).includes('not allowed'), false);
});

test('accepts CS2 GSI compatibility provider name still used by the game', () => {
  const raw = fixture();
  raw.provider.name = 'Counter-Strike: Global Offensive';
  assert.equal(normalizeGsiSnapshot(raw).provider.name, raw.provider.name);
});

test('normalizes equipped GSI weapon and available grenades safely', () => {
  const raw = fixture();
  raw.allplayers = {
    '76561198000000001': {
      team: 'CT', name: 'Sniper',
      weapons: {
        0: { name: 'weapon_awp', type: 'SniperRifle', state: 'active', ammo_clip: 7 },
        1: { name: 'weapon_flashbang', type: 'Grenade', state: 'holstered' },
        2: { name: 'weapon_smokegrenade', type: 'Grenade', state: 'holstered' },
        3: { name: '<script>', type: 'Grenade', state: 'active' },
      },
    },
    '76561198000000002': { team: 'T', name: 'No weapons' },
  };
  const result = normalizeGsiSnapshot(raw);
  assert.equal(result.players[0].activeWeapon, 'weapon_awp');
  assert.equal(result.players[0].utilityCount, 2);
  assert.equal(result.players[1].activeWeapon, undefined);
  assert.equal(result.players[1].utilityCount, undefined);
  assert.equal(JSON.stringify(result).includes('76561198000000001'), false);
  assert.equal(JSON.stringify(result).includes('ammo_clip'), false);
  assert.equal(JSON.stringify(result).includes('<script>'), false);
});

test('weapon traversal and grenade counts remain bounded', () => {
  const raw = fixture();
  raw.allplayers = { one: { team: 'CT', name: 'Utility', weapons: {} } };
  for (let i = 0; i < 100; i++) {
    raw.allplayers.one.weapons['slot_' + i] = {
      name: 'weapon_flashbang', type: 'Grenade', state: 'holstered',
    };
  }
  assert.equal(normalizeGsiSnapshot(raw).players[0].utilityCount, 8);
});

test('normalizes finite, bounded spectator phase countdown only', () => {
  const raw = fixture();
  raw.phase_countdowns = { phase: 'live', phase_ends_in: 91.25, secret: 'hidden' };
  const state = normalizeGsiSnapshot(raw);
  assert.deepEqual(state.phaseCountdown, { phase: 'live', seconds: 91.25 });
  assert.equal(JSON.stringify(state).includes('hidden'), false);
  for (const remaining of [-1, 700, Infinity, NaN, '90']) {
    raw.phase_countdowns.phase_ends_in = remaining;
    assert.equal(normalizeGsiSnapshot(raw).phaseCountdown.seconds, undefined);
  }
});

test('spectator vector parser handles valid world positions and rejects unsafe values', () => {
  assert.deepEqual(parseSpectatorVector(' -400.00, -150.00, -0.50 '), [-400, -150, -0.5]);
  assert.deepEqual(parseSpectatorVector('0,1.2,+3'), [0, 1.2, 3]);
  for (const invalid of [
    null, 1, '', '1,2', '1,2,3,4', '1,,3', '1,Infinity,3',
    '1,NaN,3', '1e309,2,3', '100001,0,0', '1;2;3',
    '1,2,0<script>', '1'.repeat(97) + ',2,3',
  ]) {
    assert.equal(parseSpectatorVector(invalid), null);
  }
});

test('spectator positions normalize without steam IDs or raw strings', () => {
  const raw = fixture();
  raw.allplayers = {
    '76561198000000001': {
      team: 'CT', name: 'Radar A', position: '566.21, 374.87, 1.41',
      forward: '0.25, 0.97, -0.01', other: 'private',
    },
    '76561198000000002': {
      team: 'T', name: 'Radar B', position: 'Infinity, 2, 3',
      forward: 'broken',
    },
  };
  const normalized = normalizeGsiSnapshot(raw);
  assert.deepEqual(normalized.players[0].position, [566.21, 374.87, 1.41]);
  assert.deepEqual(normalized.players[0].forward, [0.25, 0.97, -0.01]);
  assert.equal(normalized.players[1].position, undefined);
  assert.equal(normalized.players[1].forward, undefined);
  assert.equal(JSON.stringify(normalized).includes('76561198000000001'), false);
  assert.equal(JSON.stringify(normalized).includes('private'), false);
});
