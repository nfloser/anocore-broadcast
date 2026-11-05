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
  let inFlight = null;
  let closing = null;
  let destroyed = false;

  return {
    get current() { return current; },
    async switchTo(mode) {
      if (!['demo', 'live'].includes(mode)) throw new TypeError('Unknown broadcast mode');
      if (destroyed || inFlight) throw new Error('Broadcast is busy or closed');
      const task = (async () => {
        if (current?.mode === mode) return current;
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
        }
      })();
      inFlight = task;
      try {
        return await task;
      } finally {
        if (inFlight === task) inFlight = null;
      }
    },
    close() {
      if (closing) return closing;
      destroyed = true;
      closing = (async () => {
        if (inFlight) await inFlight.catch(() => {});
        const old = current;
        current = null;
        if (old) await old.close();
      })();
      return closing;
    },
  };
}
