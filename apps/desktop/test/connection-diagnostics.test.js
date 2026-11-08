import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeConnection, summarizeScoreboardCoverage } from '../src/connection-diagnostics.js';
import { startDesktopLive } from '../src/live-service.js';
import { createDemoFrame } from '../../overlay/src/demo-fixture.js';

test('diagnostics classify demo and never-connected observer without fake timing', () => {
  assert.deepEqual(summarizeConnection({ mode: 'demo', connection: 'synthetic', ageMs: null }), {
    code: 'demo', ageSeconds: null,
  });
  assert.deepEqual(summarizeConnection({ mode: 'live', connection: 'waiting', ageMs: null }), {
    code: 'waiting', ageSeconds: null,
  });
});

test('synthetic demo interruption does not masquerade as a healthy demo', () => {
  assert.deepEqual(summarizeConnection({ mode: 'demo', connection: 'interrupted', ageMs: null }), {
    code: 'demo-interrupted', ageSeconds: null,
  });
});

test('diagnostics report bounded, rounded age only after valid authenticated data', () => {
  assert.deepEqual(summarizeConnection({ mode: 'live', connection: 'live', ageMs: 1999 }), {
    code: 'connected', ageSeconds: 1,
  });
  assert.deepEqual(summarizeConnection({ mode: 'live', connection: 'stale', ageMs: 61590 }), {
    code: 'stale', ageSeconds: 61,
  });
  assert.deepEqual(summarizeConnection({ mode: 'live', connection: 'stale', ageMs: 500000000 }), {
    code: 'stale', ageSeconds: 86400,
  });
});

test('diagnostics fail closed on malformed states rather than presenting green connectivity', () => {
  for (const args of [
    { mode: 'live', connection: 'live', ageMs: null },
    { mode: 'live', connection: 'live', ageMs: -100 },
    { mode: 'live', connection: 'live', ageMs: NaN },
    { mode: 'live', connection: 'live', ageMs: Infinity },
    { mode: 'live', connection: 'waiting', ageMs: 100 },
    { mode: 'live', connection: 'synthetic', ageMs: 0 },
    { mode: 'unexpected', connection: 'live', ageMs: 100 },
  ]) {
    assert.deepEqual(summarizeConnection(args), { code: 'unavailable', ageSeconds: null });
  }
});

test('live service diagnostics transition waiting -> connected -> stale without exposing GSI secrets', async () => {
  let clock = 1000;
  const secret = 'desktop-diagnostics-secret-0123456789';
  const service = await startDesktopLive({
    receiverPort: 0, overlayPort: 0, token: secret, clock: () => clock,
    staleAfterMs: 5000,
  });
  try {
    assert.deepEqual(service.getStatus().diagnostics, { code: 'waiting', ageSeconds: null });
    const request = await fetch(service.gsiUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createDemoFrame(0, secret)),
    });
    assert.equal(request.status, 202);
    clock = 3200;
    assert.deepEqual(service.getStatus().diagnostics, { code: 'connected', ageSeconds: 2 });
    clock = 8001;
    assert.deepEqual(service.getStatus().diagnostics, { code: 'stale', ageSeconds: 7 });
    assert.ok(!JSON.stringify(service.getStatus()).includes(secret));
  } finally {
    await service.close();
  }
});

test('public HUD coverage distinguishes missing core score fields without revealing values', () => {
  assert.equal(summarizeScoreboardCoverage({ status: 'unavailable' }), 'unavailable');
  assert.equal(summarizeScoreboardCoverage({ status: 'ambiguous' }), 'unavailable');
  assert.equal(summarizeScoreboardCoverage({ status: 'live', map: 'de_ancient' }), 'partial');
  assert.equal(summarizeScoreboardCoverage({ status: 'live', map: '', round: 1, ctScore: 1, tScore: 0 }), 'partial');
  assert.equal(summarizeScoreboardCoverage({
    status: 'live', map: 'de_ancient', round: 0, ctScore: 0, tScore: 0,
    players: [{ name: 'secret-name', steamid: '76561198000000000' }],
  }), 'scoreboard');
  assert.equal(summarizeScoreboardCoverage({
    status: 'live', map: 'de_ancient', round: 5, ctScore: 3, tScore: null,
  }), 'partial');
});
