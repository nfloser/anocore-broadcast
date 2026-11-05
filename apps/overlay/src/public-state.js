/**
 * The public-facing projection deliberately exposes only non-sensitive
 * scoreboard fields. Raw observer payloads must never reach this API.
 */
function score(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 999 ? value : null;
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
  return {
    status: 'live',
    map: label(map.name),
    mapPhase: label(map.phase),
    round: score(map.round),
    ctScore: score(map.ctScore),
    tScore: score(map.tScore),
    roundPhase: label(round.phase),
    bombState: label(bomb.state),
  };
}
