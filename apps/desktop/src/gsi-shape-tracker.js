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
      return { windowSize: WINDOW, samples: samples.length, totalAccepted, fields };
    },
  };
}
