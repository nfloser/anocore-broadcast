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
  now = 17_001;
  assert.deepEqual(await (await fetch(stateUrl)).json(), { status: 'unavailable' });
});
