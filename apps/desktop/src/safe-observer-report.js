/**
 * Deliberately narrow diagnostic schema derived only from the *already public*
 * HUD projection. This omits team/player names, map IDs, Steam IDs, positions,
 * passwords and every other value from raw GSI. No dynamic source keys pass
 * through the returned record.
 */
export function createSafeObserverReport({ status, scoreboard } = {}) {
  if (!status || status.mode !== 'live') throw new TypeError('Live observer required');
  const code = status.diagnostics?.code;
  const connection = ['waiting', 'connected', 'stale', 'unavailable'].includes(code) ?
    code : 'unavailable';
  const age = status.diagnostics?.ageSeconds;
  const ageSeconds = Number.isSafeInteger(age) && age >= 0 && age <= 86400 ?
    age : null;
  const live = scoreboard?.status === 'live';
  const players = live && Array.isArray(scoreboard.players) ? scoreboard.players.slice(0, 10) : [];
  const present = value => value !== null && value !== undefined;
  return {
    schemaVersion: 1,
    mode: 'live',
    connection,
    ageSeconds: connection === 'connected' || connection === 'stale' ? ageSeconds : null,
    hudStatus: ['live', 'unavailable', 'ambiguous'].includes(scoreboard?.status) ?
      scoreboard.status : 'unavailable',
    rosterCount: players.length,
    fields: {
      map: live && present(scoreboard.map),
      round: live && present(scoreboard.round),
      ctScore: live && present(scoreboard.ctScore),
      tScore: live && present(scoreboard.tScore),
      phase: live && present(scoreboard.roundPhase),
      countdown: live && present(scoreboard.countdownSeconds),
      playerHealth: players.some(p => present(p?.health)),
      playerMoney: players.some(p => present(p?.money)),
      activeWeapon: players.some(p => present(p?.activeWeapon)),
    },
  };
}
