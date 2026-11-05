/**
 * Own exactly one active local service at a time. Because GSI and OBS bind to
 * fixed loopback ports, a mode switch must release old listeners first.
 * Failed switches restore the safe demo mode (not stale observer data).
 */
export function createDesktopModes({ demo, live } = {}) {
  if (typeof demo !== 'function' || typeof live !== 'function') {
    throw new TypeError('Mode factories required');
  }
  let current = null;
  let busy = false;
  let destroyed = false;
  return {
    get current() { return current; },
    async switchTo(mode) {
      if (!['demo', 'live'].includes(mode)) throw new TypeError('Unknown broadcast mode');
      if (busy || destroyed) throw new Error('Broadcast is busy or closed');
      if (current?.mode === mode) return current;
      busy = true;
      const prior = current;
      current = null;
      try {
        if (prior) await prior.close();
        current = await (mode === 'demo' ? demo() : live());
        return current;
      } catch (error) {
        if (mode === 'live' && !destroyed) {
          try {
            current = await demo();
          } catch {
            // Fail closed if even the demo cannot be started.
            current = null;
          }
        }
        throw error;
      } finally {
        busy = false;
      }
    },
    async close() {
      if (destroyed) return;
      if (busy) throw new Error('Broadcast switch in progress');
      destroyed = true;
      const old = current;
      current = null;
      if (old) await old.close();
    },
  };
}
