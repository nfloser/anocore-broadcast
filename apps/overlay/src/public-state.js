/**
 * The public-facing projection deliberately exposes only non-sensitive
 * scoreboard fields. Raw observer payloads must never reach this API.
 */
function score(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 999 ? value : null;
}
function cash(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 100000 ? value : null;
}
function label(value, max = 48) {
  return typeof value === 'string' && value.length <= max && /^[a-zA-Z0-9_ -]+$/.test(value) ? value : null;
}
export function createPublicScoreboard(timelineView) {
  if (!timelineView || typeof timelineView !== 'object') {
    throw new TypeError('Invalid timeline view');
  }
  const sources = Object.keys(timelineView.freshness ?? {});
  const ready = sources.filter(id => timelineView.freshness[id]?.status === 'live' &&
    timelineView.snapshots?.[id]);
  // Ambiguity is intentionally not resolved by guessing which observer is authoritative.
  if (ready.length !== 1) {
    return { status: ready.length > 1 ? 'ambiguous' : 'unavailable' };
  }
  const snapshot = timelineView.snapshots[ready[0]];
  const map = snapshot.map ?? {};
  const round = snapshot.round ?? {};
  const bomb = snapshot.bomb ?? {};
  const countdown = snapshot.phaseCountdown ?? {};
  const players = Array.isArray(snapshot.players) ?
    snapshot.players.filter(player => player && (player.team === 'CT' || player.team === 'T'))
      .slice(0, 10).map(player => ({
        team: player.team,
        name: typeof player.name === 'string' ? player.name.slice(0, 40) : 'Player',
        health: score(player.health),
        armor: score(player.armor),
        money: cash(player.money),
        kills: score(player.kills),
        assists: score(player.assists),
        deaths: score(player.deaths),
        slot: score(player.slot),
        activeWeapon: typeof player.activeWeapon === 'string' &&
          /^weapon_[a-z0-9_]{1,27}$/.test(player.activeWeapon) ? player.activeWeapon : null,
        utilityCount: Number.isSafeInteger(player.utilityCount) &&
          player.utilityCount >= 0 && player.utilityCount <= 8 ? player.utilityCount : null,
      })) : [];
  players.sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
  return {
    status: 'live',
    map: label(map.name),
    mapPhase: label(map.phase),
    round: score(map.round),
    ctScore: score(map.ctScore),
    tScore: score(map.tScore),
    roundPhase: label(round.phase),
    bombState: label(bomb.state),
    countdownPhase: label(countdown.phase, 32),
    countdownSeconds: typeof countdown.seconds === 'number' &&
      Number.isFinite(countdown.seconds) &&
      countdown.seconds >= 0 && countdown.seconds <= 600 ? countdown.seconds : null,
    players,
  };
}
