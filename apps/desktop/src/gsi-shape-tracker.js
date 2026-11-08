/**
 * Retain only the presence/absence of a fixed set of GSI categories.
 * Raw auth, Steam IDs, map/player names, values and individual frames are never stored.
 * The bounded window is for operator diagnostics, not state reconciliation.
 */
const FIELD_KEYS = Object.freeze([
  'map', 'round', 'completeScoreboard',
  'allplayers', 'emptyAllplayers', 'nonemptyAllplayers',
  'phaseCountdowns', 'previously', 'added',
]);
const WINDOW = 64;

export function createSafeGsiShapeTracker() {
  const samples = [];
  let totalAccepted = 0;
  return {
    accept(shape) {
      // Copy only hard-coded boolean properties. Discard every other value.
      const safe = FIELD_KEYS.map(key => shape?.[key] === true);
      samples.push(safe);
      if (samples.length > WINDOW) samples.shift();
      totalAccepted = Math.min(Number.MAX_SAFE_INTEGER, totalAccepted + 1);
    },
    summary() {
      const fields = Object.fromEntries(FIELD_KEYS.map((key, i) => [
        key, samples.reduce((sum, sample) => sum + (sample[i] ? 1 : 0), 0),
      ]));
      const scoreboardIndex = FIELD_KEYS.indexOf('completeScoreboard');
      const rosterIndex = FIELD_KEYS.indexOf('nonemptyAllplayers');
      const transitions = {
        scoreboardBecameIncomplete: 0,
        scoreboardBecameComplete: 0,
        rosterBecameMissing: 0,
        rosterBecameNonempty: 0,
        longestIncompleteScoreboardStreak: 0,
      };
      let incompleteStreak = 0;
      for (let i = 0; i < samples.length; i++) {
        const current = samples[i];
        incompleteStreak = current[scoreboardIndex] ? 0 : incompleteStreak + 1;
        transitions.longestIncompleteScoreboardStreak = Math.max(
          transitions.longestIncompleteScoreboardStreak, incompleteStreak,
        );
        if (i === 0) continue;
        const previous = samples[i - 1];
        if (previous[scoreboardIndex] && !current[scoreboardIndex]) {
          transitions.scoreboardBecameIncomplete++;
        } else if (!previous[scoreboardIndex] && current[scoreboardIndex]) {
          transitions.scoreboardBecameComplete++;
        }
        if (previous[rosterIndex] && !current[rosterIndex]) {
          transitions.rosterBecameMissing++;
        } else if (!previous[rosterIndex] && current[rosterIndex]) {
          transitions.rosterBecameNonempty++;
        }
      }
      return { windowSize: WINDOW, samples: samples.length, totalAccepted, fields, transitions };
    },
  };
}
