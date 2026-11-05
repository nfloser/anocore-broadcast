import assert from 'node:assert/strict';
import test from 'node:test';
import { createPublicScoreboard } from '../src/public-state.js';
import { createOverlayServer } from '../src/server.js';
import { createBroadcastRuntime } from '../../../services/engine/src/runtime.js';

const token = 'testing-secret-123456789';
function fixture(round) {
  return { auth: { token }, provider: { name: 'Counter-Strike 2' },
    map: { name: 'de_inferno', round, phase: 'live',
      team_ct: { score: 9 }, team_t: { score: 6 } },
    round: { phase: 'live' }, player: { name: 'Secret Player', state: { money: 12345 } } };
}
test('public projection removes player info, source IDs and arbitrary extra payload', () => {
  const projected = createPublicScoreboard({
    freshness: { 'observer-1': { status: 'live' } },
    snapshots: { 'observer-1': {
      map: { name: 'de_inferno', round: 5, ctScore: 3, tScore: 2 },
      player: { name: 'SECRET', state: { money: 9000 } }, auth: { token } } },
  });
  assert.deepEqual(projected, {
    status: 'live', map: 'de_inferno', mapPhase: null,
    round: 5, ctScore: 3, tScore: 2, roundPhase: null, bombState: null,
    players: [],
  });
  assert.ok(!JSON.stringify(projected).includes('SECRET'));
  assert.ok(!JSON.stringify(projected).includes(token));
});
test('stale, absent and ambiguous sources never expose a scoreboard', () => {
  const snapshot = { map: { name: 'de_inferno', ctScore: 6 } };
  assert.deepEqual(createPublicScoreboard({ freshness: {}, snapshots: {} }),
    { status: 'unavailable' });
  assert.deepEqual(createPublicScoreboard({
    freshness: { a: { status: 'stale' } }, snapshots: { a: snapshot },
  }), { status: 'unavailable' });
  assert.deepEqual(createPublicScoreboard({
    freshness: { a: { status: 'live' }, b: { status: 'live' } },
    snapshots: { a: snapshot, b: snapshot },
  }), { status: 'ambiguous' });
});
test('local overlay is static, read-only, CSP-protected and rejects public binding', async t => {
  assert.throws(() => createOverlayServer({ scoreboard: () => ({}) , host: '0.0.0.0' }), /loopback/);
  const server = createOverlayServer({ scoreboard: () => ({ status: 'unavailable' }), port: 0 });
  const address = await server.listen();
  t.after(() => server.close());
  const base = 'http://127.0.0.1:' + address.port;
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /AnoCore Broadcast/);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal((await fetch(base + '/overlay.css')).status, 200);
  assert.equal((await fetch(base + '/overlay.js')).status, 200);
  assert.equal((await fetch(base + '/api/state')).status, 200);
  assert.equal((await fetch(base + '/api/state', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/missing')).status, 404);
  assert.equal((await fetch(base + '/api/state')).headers.get('access-control-allow-origin'), null);
});
test('authorized GSI input becomes a time-delayed and sanitized OBS scoreboard', async t => {
  let now = 10_000;
  const runtime = createBroadcastRuntime({
    matchId: 'match-test', token, port: 0, delayMs: 2000,
    staleAfterMs: 5_000, clock: () => now,
  });
  const receiver = await runtime.listen();
  t.after(() => runtime.close());
  const overlay = createOverlayServer({
    scoreboard: () => createPublicScoreboard(runtime.view()),
    port: 0,
  });
  const ui = await overlay.listen();
  t.after(() => overlay.close());
  const stateUrl = 'http://127.0.0.1:' + ui.port + '/api/state';
  const before = await (await fetch(stateUrl)).json();
  assert.equal(before.status, 'unavailable');
  const posted = await fetch('http://127.0.0.1:' + receiver.port + '/gsi', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fixture(12)),
  });
  assert.equal(posted.status, 202);
  assert.equal((await (await fetch(stateUrl)).json()).status, 'unavailable');
  now = 12_000;
  const data = await (await fetch(stateUrl)).json();
  assert.equal(data.status, 'live');
  assert.equal(data.map, 'de_inferno');
  assert.equal(data.ctScore, 9);
  assert.equal(data.tScore, 6);
  assert.equal(data.round, 12);
  assert.equal(JSON.stringify(data).includes('Secret Player'), false);
  assert.equal(JSON.stringify(data).includes('12345'), false);
  assert.deepEqual(data.players, []);
  now = 17_001;
  assert.deepEqual(await (await fetch(stateUrl)).json(), { status: 'unavailable' });
});

test('spectator roster is allowlisted, without Steam IDs or arbitrary weapons', () => {
  const state = createPublicScoreboard({
    freshness: { source: { status: 'live' } },
    snapshots: { source: {
      map: { ctScore: 2, tScore: 1 },
      players: [{ name: '<img src=x onerror=alert(1)>', team: 'CT',
        health: 50, armor: 100, money: 5000, kills: 9, assists: 1,
        deaths: 3, steamid: '76561198000000001', weapons: { hidden: 'knife' } }],
    } },
  });
  assert.equal(state.players[0].name, '<img src=x onerror=alert(1)>');
  assert.equal(state.players[0].money, 5000);
  assert.equal(JSON.stringify(state).includes('76561198000000001'), false);
  assert.equal(JSON.stringify(state).includes('knife'), false);
  assert.deepEqual(createPublicScoreboard({
    freshness: { source: { status: 'stale' } },
    snapshots: { source: { players: [{ name: 'Private', team: 'CT' }] } },
  }), { status: 'unavailable' });
});

test('public weapon projection never exposes raw weapon objects', () => {
  const state = createPublicScoreboard({
    freshness: { observer: { status: 'live' } },
    snapshots: { observer: { players: [{
      team: 'CT', name: 'Player', activeWeapon: 'weapon_ak47',
      utilityCount: 3, inventory: { secret: 'hidden' },
    }] } },
  });
  assert.equal(state.players[0].activeWeapon, 'weapon_ak47');
  assert.equal(state.players[0].utilityCount, 3);
  assert.equal(JSON.stringify(state).includes('hidden'), false);
  const malformed = createPublicScoreboard({
    freshness: { observer: { status: 'live' } },
    snapshots: { observer: { players: [{
      team: 'T', name: 'Player', activeWeapon: 'javascript:alert(1)', utilityCount: 99,
    }] } },
  });
  assert.equal(malformed.players[0].activeWeapon, null);
  assert.equal(malformed.players[0].utilityCount, null);
});

test('weapon fields survive HTTP-to-OBS and are removed when data becomes stale', async t => {
  let now = 1000;
  const runtime = createBroadcastRuntime({
    matchId: 'weapons', token, port: 0, clock: () => now, staleAfterMs: 1000,
  });
  const receiver = await runtime.listen();
  t.after(() => runtime.close());
  const overlay = createOverlayServer({ port: 0,
    scoreboard: () => createPublicScoreboard(runtime.view()) });
  const observer = await overlay.listen();
  t.after(() => overlay.close());
  const raw = fixture(3);
  raw.allplayers = { '76561198000000123': {
    team: 'CT', name: 'Rifle',
    weapons: {
      1: { name: 'weapon_m4a1', type: 'Rifle', state: 'active' },
      2: { name: 'weapon_hegrenade', type: 'Grenade', state: 'holstered' },
    },
  } };
  const response = await fetch('http://127.0.0.1:' + receiver.port + '/gsi', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(raw),
  });
  assert.equal(response.status, 202);
  const api = 'http://127.0.0.1:' + observer.port + '/api/state';
  const live = await (await fetch(api)).json();
  assert.equal(live.players[0].activeWeapon, 'weapon_m4a1');
  assert.equal(live.players[0].utilityCount, 1);
  assert.equal(JSON.stringify(live).includes('76561198000000123'), false);
  now = 2001;
  assert.deepEqual(await (await fetch(api)).json(), { status: 'unavailable' });
});
