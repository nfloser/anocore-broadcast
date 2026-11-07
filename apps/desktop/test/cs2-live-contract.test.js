import assert from 'node:assert/strict';
import test from 'node:test';
import { startDesktopLive } from '../src/live-service.js';

/**
 * An independent, CS2-shaped contract sample. This is authored separately
 * from createDemoFrame and is NOT a recording captured from a real game.
 * Steam IDs, coordinates and the token exist only inside this test process.
 */
function observerFrame(token, overrides = {}) {
  const allplayers = {};
  for (let i = 0; i < 10; i++) {
    const team = i < 5 ? 'CT' : 'T';
    const slot = i < 5 ? i + 1 : i + 1;
    const weapons = {
      weapon_0: { name: 'weapon_knife', type: 'Knife', state: 'holstered' },
      weapon_1: { name: team === 'CT' ? 'weapon_m4a1' : 'weapon_ak47',
        type: 'Rifle', state: 'active' },
    };
    if (i === 0) {
      weapons.weapon_2 = { name: 'weapon_flashbang', type: 'Grenade', state: 'holstered' };
      weapons.weapon_3 = { name: 'weapon_smokegrenade', type: 'Grenade', state: 'holstered' };
    }
    allplayers[String(76561199000000001n + BigInt(i))] = {
      name: 'Observer Player ' + i,
      team,
      observer_slot: slot,
      state: { health: i === 0 ? 43 : 100, armor: 75, money: 2600 + i * 100 },
      match_stats: { kills: i + 5, assists: i % 3, deaths: 2 },
      position: (123 + i * 4) + ', ' + (-222 + i * 2) + ', 12',
      forward: '0, 1, 0',
      weapons,
      steamid: '76561199000000001',
    };
  }
  return {
    auth: { token },
    provider: {
      name: 'Counter-Strike 2',
      timestamp: 1794090000,
      steamid: '76561199999999999',
    },
    map: {
      name: 'de_ancient', phase: 'live', round: 12,
      team_ct: { score: 7, name: 'Blue Team' },
      team_t: { score: 5, name: 'Gold Team' },
    },
    round: { phase: 'live', bomb: 'planted' },
    phase_countdowns: { phase: 'live', phase_ends_in: 37.5 },
    allplayers,
    ...overrides,
  };
}

async function send(url, frame) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify(frame),
  });
}
async function publicState(service) {
  const response = await fetch(service.hudUrl + 'api/state');
  assert.equal(response.status, 200);
  return response.json();
}

test('independent CS2-shaped observer contract populates the live HUD exactly', async () => {
  let now = 10_000;
  const token = 'cs2-contract-local-secret-1234567890';
  const service = await startDesktopLive({
    receiverPort: 0, overlayPort: 0, token,
    clock: () => now, staleAfterMs: 5000,
  });
  try {
    assert.deepEqual(await publicState(service), {
      status: 'unavailable',
      settings: service.getSettings(),
    });
    assert.equal(service.getStatus().diagnostics.code, 'waiting');

    const unauthorized = observerFrame('invalid-unauthorized-key');
    const rejected = await send(service.gsiUrl, unauthorized);
    assert.equal(rejected.status, 401);
    assert.equal(service.getStatus().diagnostics.code, 'waiting');
    assert.equal((await publicState(service)).status, 'unavailable');

    const accepted = await send(service.gsiUrl, observerFrame(token));
    assert.equal(accepted.status, 202);
    const state = await publicState(service);
    assert.equal(state.status, 'live');
    assert.equal(state.map, 'de_ancient');
    assert.equal(state.mapPhase, 'live');
    assert.equal(state.round, 12);
    assert.equal(state.ctScore, 7);
    assert.equal(state.tScore, 5);
    assert.equal(state.roundPhase, 'live');
    assert.equal(state.countdownPhase, 'live');
    assert.equal(state.countdownSeconds, 37.5);
    assert.equal(state.players.length, 10);
    assert.deepEqual(state.players.map(player => player.team),
      ['CT','CT','CT','CT','CT','T','T','T','T','T']);
    assert.equal(state.players[0].name, 'Observer Player 0');
    assert.equal(state.players[0].health, 43);
    assert.equal(state.players[0].money, 2600);
    assert.equal(state.players[0].kills, 5);
    assert.equal(state.players[0].assists, 0);
    assert.equal(state.players[0].deaths, 2);
    assert.equal(state.players[0].activeWeapon, 'weapon_m4a1');
    assert.equal(state.players[0].utilityCount, 2);
    assert.equal(state.players[5].activeWeapon, 'weapon_ak47');

    const serialized = JSON.stringify(state);
    for (const forbidden of [
      token, '76561199000000001', '76561199999999999',
      '"auth"', '"position"', '"forward"', '"steamid"',
      '"provider"', '"raw"', '"radar"', '"demo"',
    ]) assert.equal(serialized.includes(forbidden), false, 'Unexpected public field: ' + forbidden);

    now += 5001;
    assert.equal((await publicState(service)).status, 'unavailable');
    assert.equal(service.getStatus().diagnostics.code, 'stale');

    const fresh = observerFrame(token, {
      map: {
        name: 'de_ancient', phase: 'live', round: 13,
        team_ct: { score: 8 }, team_t: { score: 5 },
      },
    });
    const again = await send(service.gsiUrl, fresh);
    assert.equal(again.status, 202);
    const recovered = await publicState(service);
    assert.equal(recovered.status, 'live');
    assert.equal(recovered.round, 13);
    assert.equal(recovered.ctScore, 8);
    assert.equal(service.getStatus().diagnostics.code, 'connected');
  } finally {
    await service.close();
  }
});

test('partial spectator GSI does not invent player, round or map information', async () => {
  const token = 'cs2-contract-partial-secret-1234567890';
  const service = await startDesktopLive({ receiverPort: 0, overlayPort: 0, token });
  try {
    const response = await send(service.gsiUrl, {
      auth: { token },
      provider: { name: 'Counter-Strike 2', timestamp: 1794090001 },
      map: { name: 'de_inferno', phase: 'warmup' },
    });
    assert.equal(response.status, 202);
    const state = await publicState(service);
    assert.equal(state.status, 'live');
    assert.equal(state.map, 'de_inferno');
    assert.equal(state.round, null);
    assert.equal(state.ctScore, null);
    assert.equal(state.tScore, null);
    assert.deepEqual(state.players, []);
    assert.equal(state.countdownSeconds, null);
    assert.equal(state.radar, undefined);
  } finally {
    await service.close();
  }
});
