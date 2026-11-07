/**
 * The operator may inspect only a coarse connection state and last accepted
 * message age. Never return GSI tokens, provider IDs, or raw source payloads.
 */
export function summarizeConnection({ mode, connection, ageMs } = {}) {
  if (mode === 'demo' && connection === 'synthetic' && ageMs == null) {
    return { code: 'demo', ageSeconds: null };
  }
  if (mode !== 'live') return { code: 'unavailable', ageSeconds: null };
  if (connection === 'waiting' && ageMs == null) {
    return { code: 'waiting', ageSeconds: null };
  }
  if (!['live', 'stale'].includes(connection) ||
      typeof ageMs !== 'number' || !Number.isFinite(ageMs) || ageMs < 0) {
    return { code: 'unavailable', ageSeconds: null };
  }
  return {
    code: connection === 'live' ? 'connected' : 'stale',
    ageSeconds: Math.min(86400, Math.floor(ageMs / 1000)),
  };
}

/**
 * Coarse, identity-free assessment of how much *public* HUD data is present.
 * This is not a claim of correct or synchronized CS2/GOTV information.
 */
export function summarizeScoreboardCoverage(scoreboard) {
  if (scoreboard?.status !== 'live') return 'unavailable';
  if (scoreboard.map != null && scoreboard.round != null &&
      scoreboard.ctScore != null && scoreboard.tScore != null) return 'scoreboard';
  return 'partial';
}
