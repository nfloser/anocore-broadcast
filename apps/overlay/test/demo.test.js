import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoFrame } from '../src/demo-fixture.js';
import { normalizeGsiSnapshot } from '../../../adapters/cs2/src/index.js';
import { createBroadcastRuntime } from '../../../services/engine/src/runtime.js';
import { createPublicScoreboard } from '../src/public-state.js';
import { createOverlayServer } from '../src/server.js';

test('demo fixture is deterministic, has ten players and no real steam credentials', () => {
  const frame = createDemoFrame(3, 'fixture-secret');
  const payload = normalizeGsiSnapshot(frame);
  assert.equal(payload.players.length, 10);
  assert.equal(payload.players.filter(p => p.team === 'CT').length, 5);
  assert.equal(payload.players.filter(p => p.team === 'T').length, 5);
  assert.equal(frame.auth.token, 'fixture-secret');
  assert.equal(payload.map.name, 'de_nuke');
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
  assert.equal(after.map, 'de_nuke');
  assert.equal(JSON.stringify(after).includes(token), false);
});
