import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoFrame } from '../src/demo-fixture.js';
import { createDemoRadar } from '../src/demo-radar.js';
import { normalizeGsiSnapshot } from '../../../adapters/cs2/src/index.js';
import { createBroadcastRuntime } from '../../../services/engine/src/runtime.js';
import { createPublicScoreboard } from '../src/public-state.js';
import { createOverlayServer } from '../src/server.js';
import { createBroadcastSettings } from '../../manager/src/settings.js';
import { createManagerServer } from '../../manager/src/server.js';

test('demo fixture is deterministic, has ten players and no real steam credentials', () => {
  const frame = createDemoFrame(3, 'fixture-secret');
  assert.deepEqual(createDemoFrame(3, 'fixture-secret'), frame);
  const payload = normalizeGsiSnapshot(frame);
  assert.equal(payload.players.length, 10);
  assert.equal(payload.players.filter(p => p.team === 'CT').length, 5);
  assert.equal(payload.players.filter(p => p.team === 'T').length, 5);
  assert.equal(frame.auth.token, 'fixture-secret');
  assert.equal(payload.map.name, 'de_nuke');
  assert.equal(payload.phaseCountdown.seconds, 85);
  assert.equal(payload.players[0].activeWeapon, 'weapon_awp');
  assert.equal(payload.players[0].utilityCount, 2);
  assert.equal(payload.players[0].position.length, 3);
  assert.throws(() => createDemoFrame(-1, 'x'));
});

test('synthetic HTTP GSI drives a clearly marked demo scoreboard', async t => {
  const token = 'test-secret-0123456789';
  const runtime = createBroadcastRuntime({
    matchId: 'demo-match', token, port: 0, staleAfterMs: 10000,
  });
  const addr = await runtime.listen();
  t.after(() => runtime.close());
  const overlay = createOverlayServer({
    port: 0, scoreboard: () => ({ ...createPublicScoreboard(runtime.view()), demo: true }),
  });
  const ui = await overlay.listen();
  t.after(() => overlay.close());
  const api = 'http://127.0.0.1:' + ui.port + '/api/state';
  const before = await (await fetch(api)).json();
  assert.equal(before.demo, true);
  assert.equal(before.status, 'unavailable');
  assert.equal((await fetch('http://127.0.0.1:' + addr.port + '/gsi', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(createDemoFrame(3, token)),
  })).status, 202);
  const after = await (await fetch(api)).json();
  assert.equal(after.demo, true);
  assert.equal(after.status, 'live');
  assert.equal(after.players.length, 10);
  assert.equal(after.players[0].activeWeapon, 'weapon_awp');
  assert.equal(after.players[0].utilityCount, 2);
  assert.equal(after.map, 'de_nuke');
  assert.equal(after.countdownSeconds, 85);
  assert.equal(JSON.stringify(after).includes(token), false);
});

test('demo operator settings update rendered fixture state without removing DEMO label', async t => {
  const token = 'test-secret-0123456789';
  const adminToken = 'operator-secret-01234567890123456789';
  const runtime = createBroadcastRuntime({
    matchId: 'demo-match', token, port: 0, staleAfterMs: 10000,
  });
  const receiver = await runtime.listen();
  t.after(() => runtime.close());
  const settings = createBroadcastSettings();
  const overlay = createOverlayServer({
    port: 0,
    scoreboard: () => {
      const config = settings.get();
      const state = createPublicScoreboard(runtime.view());
      return { ...state, demo: true, settings: config,
        players: config.showRoster ? state.players : [] };
    },
  });
  const observer = await overlay.listen();
  t.after(() => overlay.close());
  const manager = createManagerServer({ settings, token: adminToken, port: 0 });
  const operator = await manager.listen();
  t.after(() => manager.close());
  const url = 'http://127.0.0.1:' + observer.port + '/api/state';
  const adminUrl = 'http://127.0.0.1:' + operator.port;
  const post = await fetch('http://127.0.0.1:' + receiver.port + '/gsi', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(createDemoFrame(1, token)),
  });
  assert.equal(post.status, 202);
  const before = await (await fetch(url)).json();
  assert.equal(before.players.length, 10);
  const update = await fetch(adminUrl + '/api/config', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + adminToken, origin: adminUrl,
      'content-type': 'application/json' },
    body: JSON.stringify({ ctName: 'Demo Team', showRoster: false }),
  });
  assert.equal(update.status, 200);
  const after = await (await fetch(url)).json();
  assert.equal(after.demo, true);
  assert.equal(after.settings.ctName, 'Demo Team');
  assert.deepEqual(after.players, []);
  assert.equal(JSON.stringify(after).includes(adminToken), false);
});

test('only the synthetic demo projection supplies bounded radar markers', () => {
  const raw = createDemoFrame(3, 'fixture-secret');
  const snapshot = normalizeGsiSnapshot(raw);
  const view = {
    freshness: { observer: { status: 'live' } },
    snapshots: { observer: snapshot },
  };
  const result = createDemoRadar(view);
  assert.equal(result.kind, 'synthetic');
  assert.equal(result.markers.length, 10);
  assert.ok(result.markers.every(marker =>
    marker.x >= 0 && marker.x <= 1 && marker.y >= 0 && marker.y <= 1));
  assert.ok(result.markers.every(marker =>
    !Object.hasOwn(marker, 'position') && !Object.hasOwn(marker, 'forward')));
  assert.ok(!JSON.stringify(result).includes('765611980'));
  const publicState = createPublicScoreboard(view);
  assert.equal(Object.hasOwn(publicState, 'radar'), false);
  assert.equal(JSON.stringify(publicState).includes('position'), false);
});

test('demo radar rejects stale snapshots, ambiguous sources and wrong map', () => {
  const snapshot = normalizeGsiSnapshot(createDemoFrame(3, 'fixture-secret'));
  const one = { freshness: { observer: { status: 'stale' } },
    snapshots: { observer: snapshot } };
  assert.equal(createDemoRadar(one), null);
  one.freshness.observer.status = 'live';
  one.freshness.second = { status: 'live' };
  one.snapshots.second = snapshot;
  assert.equal(createDemoRadar(one), null);
  delete one.freshness.second;
  delete one.snapshots.second;
  one.snapshots.observer.map.name = 'de_inferno';
  assert.equal(createDemoRadar(one), null);
});

test('synthetic radar excludes out-of-bounds players instead of clamping markers', () => {
  const snapshot = normalizeGsiSnapshot(createDemoFrame(3, 'fixture-secret'));
  snapshot.players[0].position = [2000, 2000, 0];
  const result = createDemoRadar({
    freshness: { observer: { status: 'live' } },
    snapshots: { observer: snapshot },
  });
  assert.equal(result.markers.length, 9);
});
