/**
 * Synthetic broadcast fixtures for local visual testing only.
 * Never used by the production receiver or in a real match.
 */
export function createDemoFrame(step, token) {
  if (!Number.isSafeInteger(step) || step < 0 || typeof token !== 'string') {
    throw new TypeError('Invalid demo options');
  }
  const ct = ['Atlas', 'Mako', 'Zero', 'Raven', 'Ghost'];
  const tt = ['Nova', 'Vex', 'Kite', 'Blaze', 'Drift'];
  const allplayers = {};
  for (let i = 0; i < 10; i++) {
    const name = i < 5 ? ct[i] : tt[i - 5];
    allplayers[String(76561198000000000n + BigInt(i))] = {
      name, team: i < 5 ? 'CT' : 'T',
      observer_slot: i === 9 ? 0 : i + 1,
      state: {
        health: ((step + i * 3) % 20 === 0) ? 0 : Math.max(15, 100 - ((step * 3 + i * 7) % 75)),
        armor: 100 - (i * 7), money: Math.min(16000, 2500 + i * 730 + step * 40),
      },
      weapons: {
        0: { name: 'weapon_knife', type: 'Knife', state: 'holstered' },
        1: { name: i % 3 === 0 ? 'weapon_awp' : i < 5 ? 'weapon_m4a1' : 'weapon_ak47',
          type: i % 3 === 0 ? 'SniperRifle' : 'Rifle', state: 'active' },
        2: { name: 'weapon_flashbang', type: 'Grenade', state: 'holstered' },
        3: { name: 'weapon_smokegrenade', type: 'Grenade', state: 'holstered' },
      },
      match_stats: {
        kills: i * 2 + Math.floor(step / 4), assists: i % 4,
        deaths: Math.floor(step / 7) + i % 3,
      },
    };
  }
  const round = Math.floor(step / 10) + 1;
  return {
    auth: { token },
    provider: { name: 'Counter-Strike: Global Offensive', timestamp: 1793900000 + step * 2 },
    map: { name: 'de_nuke', phase: 'live', round,
      team_ct: { score: 5 + Math.floor(round / 2) },
      team_t: { score: 4 + Math.floor((round - 1) / 2) } },
    round: { phase: step % 10 < 2 ? 'freezetime' : 'live' },
    phase_countdowns: { phase: step % 10 < 2 ? 'freezetime' : 'live', phase_ends_in: Math.max(0, 115 - (step % 10) * 10) },
    allplayers,
  };
}
