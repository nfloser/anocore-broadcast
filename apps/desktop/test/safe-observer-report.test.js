import assert from 'node:assert/strict';
import test from 'node:test';
import { createSafeObserverReport } from '../src/safe-observer-report.js';
import { startDesktopLive } from '../src/live-service.js';

test('safe report is a strict field-only allowlist, never identity or raw observer data', () => {
  const token = 'private-credential-never-copy';
  const report = createSafeObserverReport({
    status: {
      mode: 'live', diagnostics: { code: 'connected', ageSeconds: 3 },
      raw: { token },
    },
    scoreboard: {
      status: 'live', map: 'de_secret_map',
      round: 7, ctScore: 5, tScore: 2,
      roundPhase: 'live', countdownSeconds: 47,
      teamName: 'secret-team-name', token,
      players: [{ name: 'secret-player-name', steamid: '76561199000000001',
        health: 50, money: 2000, activeWeapon: 'weapon_awp',
        position: [123, 456, 789], auth: { token } }],
      radar: { markers: [{ id: 'secret-player-name' }] },
    },
  });
  assert.deepEqual(report, {
    schemaVersion: 1, mode: 'live', connection: 'connected', ageSeconds: 3,
    hudStatus: 'live', rosterCount: 1,
    fields: {
      map: true, round: true, ctScore: true, tScore: true,
      phase: true, countdown: true, playerHealth: true, playerMoney: true,
      activeWeapon: true,
    },
  });
  const serialized = JSON.stringify(report);
  for (const secret of [token, 'de_secret_map', 'secret-team-name', 'secret-player-name',
    '76561199000000001', '123', 'weapon_awp', '"radar"']) {
    assert.equal(serialized.includes(secret), false, 'Leaked: ' + secret);
  }
});

test('waiting and stale diagnostics provide no invented live fields or names', () => {
  assert.deepEqual(createSafeObserverReport({
    status: { mode: 'live', diagnostics: { code: 'waiting', ageSeconds: null } },
    scoreboard: { status: 'unavailable', settings: { ctName: 'PRIVATE' } },
  }), {
    schemaVersion: 1, mode: 'live', connection: 'waiting', ageSeconds: null,
    hudStatus: 'unavailable', rosterCount: 0,
    fields: {
      map: false, round: false, ctScore: false, tScore: false,
      phase: false, countdown: false, playerHealth: false, playerMoney: false,
      activeWeapon: false,
    },
  });
  const stale = createSafeObserverReport({
    status: { mode: 'live', diagnostics: { code: 'stale', ageSeconds: 40 } },
    scoreboard: { status: 'unavailable', players: [{ name: 'SECRET', health: 100 }] },
  });
  assert.equal(stale.connection, 'stale');
  assert.equal(stale.ageSeconds, 40);
  assert.equal(stale.rosterCount, 0);
  assert.equal(stale.fields.playerHealth, false);
  assert.throws(() => createSafeObserverReport({ status: { mode: 'demo' } }), /Live observer/);
});

test('localhost live service yields safe diagnostics without authenticating a secret to UI', async () => {
  const token = 'report-secret-0123456789abcdefabcdef';
  let now = 1000;
  const service = await startDesktopLive({
    receiverPort: 0, overlayPort: 0, token, clock: () => now, staleAfterMs: 5000,
  });
  try {
    assert.equal(service.getDiagnosticReport().connection, 'waiting');
    const raw = {
      auth: { token },
      provider: { name: 'Counter-Strike 2', steamid: '76561199999999999' },
      map: { name: 'de_ancient', phase: 'live', round: 4,
        team_ct: { score: 2 }, team_t: { score: 1 } },
      allplayers: {
        '76561199000000001': {
          name: 'SENSITIVE NAME', team: 'CT', observer_slot: 1,
          state: { health: 95, money: 3200 },
          position: '12, 44, 77', weapons: {
            0: { name: 'weapon_awp', state: 'active', type: 'SniperRifle' },
          },
        },
      },
    };
    const res = await fetch(service.gsiUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(raw),
    });
    assert.equal(res.status, 202);
    const report = service.getDiagnosticReport();
    assert.equal(report.connection, 'connected');
    assert.equal(report.rosterCount, 1);
    assert.equal(report.fields.activeWeapon, true);
    assert.equal(report.fields.countdown, false);
    const json = JSON.stringify(report);
    for (const word of [token, 'de_ancient', 'SENSITIVE', '7656119', 'position', 'weapon_awp']) {
      assert.equal(json.includes(word), false);
    }
    now = 7001;
    const stale = service.getDiagnosticReport();
    assert.equal(stale.connection, 'stale');
    assert.equal(stale.hudStatus, 'unavailable');
    assert.equal(stale.rosterCount, 0);
  } finally {
    await service.close();
  }
});

test('diagnostic shape counts only accepted authenticated frames and never copies source fields', async () => {
  const token = 'shape-test-secret-0123456789abcdef';
  const service = await startDesktopLive({ receiverPort: 0, overlayPort: 0, token });
  const post = async raw => (await fetch(service.gsiUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(raw),
  })).status;
  try {
    let shape = service.getDiagnosticReport().gsiFieldShapes;
    assert.equal(shape.samples, 0);
    assert.equal(shape.totalAccepted, 0);

    assert.equal(await post({ auth: { token: 'wrong-secret' }, provider: { name: 'Counter-Strike 2' },
      previously: { secret: 'NOT FOR REPORT' } }), 401);
    assert.equal(service.getDiagnosticReport().gsiFieldShapes.totalAccepted, 0);

    assert.equal(await post({ auth: { token }, provider: { name: 'Counter-Strike 2' },
      map: { name: 'PRIVATE_MAP_NAME', round: 3, team_ct: { score: 2 }, team_t: { score: 1 } },
      allplayers: {}, previously: { allplayers: { secret: 'PRIVATE' } } }), 202);
    assert.equal(await post({ auth: { token }, provider: { name: 'Counter-Strike 2' },
      round: { phase: 'live' }, added: { map: { name: 'PRIVATE_ADDED_MAP' } } }), 202);
    const report = service.getDiagnosticReport();
    shape = report.gsiFieldShapes;
    assert.equal(shape.totalAccepted, 2);
    assert.equal(shape.samples, 2);
    assert.deepEqual(shape.fields, {
      map: 1, round: 1, allplayers: 1, emptyAllplayers: 1,
      phaseCountdowns: 0, previously: 1, added: 1,
    });
    const json = JSON.stringify(report);
    for (const secret of [token, 'PRIVATE', 'NOT FOR REPORT', 'allplayers: { secret']) {
      assert.equal(json.includes(secret), false);
    }
  } finally {
    await service.close();
  }
});
