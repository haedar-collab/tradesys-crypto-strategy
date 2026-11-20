/**
 * 1H entry trigger after a 4H demand-zone touch.
 * Preserves the original Tradesys trigger priority: bullish 1H structure
 * break first, then 1H swing-low sweep-and-reclaim.
 */

import { structureEvents } from "./events.js";

function pivotsUpTo(pivots, index, confirmationBars) {
  return {
    hi: pivots.hi.filter(value => value <= index - confirmationBars),
    lo: pivots.lo.filter(value => value <= index - confirmationBars)
  };
}

export function evaluateLtfTrigger(p1h, zone, atr4h) {
  if (!p1h || p1h.n < 60 || !zone) return null;
  if (!Number.isFinite(atr4h) || atr4h <= 0 || !Number.isFinite(zone.lo) || !Number.isFinite(zone.hi) || zone.lo >= zone.hi) {
    throw new RangeError("valid zone bounds and positive 4H ATR are required");
  }
  const n = p1h.n, i = n - 1, close = p1h.c[i], atr1h = p1h.atr?.[i] || atr4h / 2;
  const lookback = 12, start = Math.max(0, n - lookback);
  let touch = -1;
  for (let q = start; q < n; q++) {
    if (p1h.l[q] <= zone.hi) { touch = q; break; }
  }
  const result = {
    state: "none", trigger: null, at: null, level: null, close,
    t: p1h.ct[i] + 1, stop1h: null, touchedAt: touch >= 0 ? p1h.t[touch] : null
  };
  if (close < zone.lo - 0.1 * atr4h) return { ...result, state: "broken" };
  if (touch < 0) return result;
  result.state = "touch";
  const lowSince = Math.min(...p1h.l.slice(touch, n));
  result.stop1h = Math.min(lowSince - 0.25 * atr1h, close - Math.max(atr1h, 0.5 * atr4h));

  const bullishEvents = structureEvents(p1h).events.filter(event => event.dir === 1 && event.i >= touch && event.i >= start);
  if (bullishEvents.length) {
    const event = bullishEvents[bullishEvents.length - 1];
    return { ...result, state: "confirmed", trigger: `1H ${event.type}`, at: p1h.t[event.i], level: event.level };
  }

  const pivots = pivotsUpTo(p1h.piv, i, 2);
  for (const pivotIndex of pivots.lo.filter(value => value >= n - 60).reverse()) {
    const level = p1h.l[pivotIndex];
    if (level > zone.hi || level < zone.lo - 0.5 * atr4h) continue;
    for (let q = Math.max(pivotIndex + 1, touch); q < n; q++) {
      if (p1h.l[q] < level && p1h.c[q] > level && close > level && close > p1h.o[q]) {
        return { ...result, state: "confirmed", trigger: "1H sweep + reclaim", at: p1h.t[q], level };
      }
    }
  }
  return result;
}
