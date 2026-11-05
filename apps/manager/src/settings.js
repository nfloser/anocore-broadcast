const DEFAULTS = Object.freeze({
  ctName: 'COUNTER-TERRORISTS',
  tName: 'TERRORISTS',
  ctColor: '#67addd',
  tColor: '#dcbb5b',
  showRoster: true,
});
const ALLOWED = new Set(Object.keys(DEFAULTS));
const NAME = /^[\p{L}\p{N} _-]{1,28}$/u;
const COLOR = /^#[0-9a-fA-F]{6}$/;

export function createBroadcastSettings() {
  let current = { ...DEFAULTS };
  function get() { return { ...current }; }
  function update(changes) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes) ||
        Object.getPrototypeOf(changes) !== Object.prototype) {
      throw new TypeError('Invalid settings object');
    }
    if (!Object.keys(changes).length || Object.keys(changes).some(k => !ALLOWED.has(k))) {
      throw new TypeError('Unknown or empty settings update');
    }
    for (const [key, value] of Object.entries(changes)) {
      if (key === 'ctName' || key === 'tName') {
        if (typeof value !== 'string' || !NAME.test(value)) throw new TypeError('Invalid team name');
      } else if (key === 'ctColor' || key === 'tColor') {
        if (typeof value !== 'string' || !COLOR.test(value)) throw new TypeError('Invalid color');
      } else if (key === 'showRoster' && typeof value !== 'boolean') {
        throw new TypeError('Invalid roster setting');
      }
    }
    current = { ...current, ...changes };
    return get();
  }
  return { get, update };
}
