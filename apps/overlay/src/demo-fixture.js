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
      match_stats: {
        kills: i * 2 + Math.floor(step / 4), assists: i % 4,
        deaths: Math.floor(step / 7) + i % 3,
      },
    };
  }
  const round = Math.floor(step / 10) + 1;
  return {
    auth: { token },
    provider: { name: 'Counter-Strike: Global Offensive', timestamp: Math.floor(Date.now() / 1000) },
    map: { name: 'de_nuke', phase: 'live', round,
      team_ct: { score: 5 + Math.floor(round / 2) },
      team_t: { score: 4 + Math.floor((round - 1) / 2) } },
    round: { phase: step % 10 < 2 ? 'freezetime' : 'live' },
    allplayers,
  };
}
