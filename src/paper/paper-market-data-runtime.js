/**
 * Lifecycle controller for explicit paper mark cadence. It never closes the
 * paper session and never submits orders; it only asks the bridge to mark.
 */
export function createPaperMarketDataRuntime({
  supervisor,
  bridge,
  markIntervalMs = 1_000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  onMark = () => {},
  onError = () => {}
} = {}) {
  if (!supervisor || typeof supervisor.start !== "function" || typeof supervisor.stop !== "function") {
    throw new TypeError("compatible market data supervisor is required");
  }
  if (!bridge || typeof bridge.markOpenPositions !== "function") throw new TypeError("compatible paper market data bridge is required");
  if (!Number.isSafeInteger(markIntervalMs) || markIntervalMs < 1) throw new RangeError("markIntervalMs must be a positive integer");
  if (typeof setTimeoutFn !== "function" || typeof clearTimeoutFn !== "function") throw new TypeError("timer functions are required");
  if (typeof onMark !== "function" || typeof onError !== "function") throw new TypeError("callbacks must be functions");

  let started = false;
  let timer = null;
  let inFlight = null;

  function scheduleNext() {
    if (!started || timer !== null) return;
    timer = setTimeoutFn(async () => {
      timer = null;
      if (!started) return;
      try { await markNow(); }
      catch (error) { onError(error); }
      scheduleNext();
    }, markIntervalMs);
  }

  function markNow() {
    if (!started) return Promise.reject(new Error("paper market data runtime is not started"));
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(() => bridge.markOpenPositions())
      .then(result => {
        onMark(result);
        return result;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  }

  return Object.freeze({
    start() {
      if (started) return;
      supervisor.start();
      started = true;
      scheduleNext();
    },
    async stop() {
      if (!started) return;
      started = false;
      if (timer !== null) clearTimeoutFn(timer);
      timer = null;
      supervisor.stop();
      if (inFlight) await inFlight.catch(() => {});
    },
    markNow,
    getStatus() {
      return { state: started ? "RUNNING" : "STOPPED", markInFlight: inFlight !== null, timerScheduled: timer !== null };
    }
  });
}
