/**
 * Confirmed-pivot market structure events (BOS / CHoCH).
 * This preserves the original Tradesys event ordering and trend-state logic.
 * Only closed-bar prepared series should be passed to this function.
 */

export function structureEvents(prepared, confirmationBars = 3) {
  if (!prepared || !Number.isInteger(prepared.n) || prepared.n < 0 ||
      !Array.isArray(prepared.c) || !Array.isArray(prepared.h) || !Array.isArray(prepared.l) ||
      prepared.c.length !== prepared.n || prepared.h.length !== prepared.n || prepared.l.length !== prepared.n) {
    throw new TypeError("prepared series must contain aligned c, h, l arrays and n");
  }
  if (!prepared.piv || !Array.isArray(prepared.piv.hi) || !Array.isArray(prepared.piv.lo)) {
    throw new TypeError("prepared series must include numeric pivot arrays { hi, lo }");
  }
  if (!Number.isInteger(confirmationBars) || confirmationBars < 1) {
    throw new RangeError("confirmationBars must be a positive integer");
  }

  let trend = 0, lastHi = null, lastLo = null, highPointer = 0, lowPointer = 0;
  const events = [];
  for (let i = 0; i < prepared.n; i++) {
    while (highPointer < prepared.piv.hi.length && prepared.piv.hi[highPointer] <= i - confirmationBars) {
      const pivotIndex = prepared.piv.hi[highPointer++];
      lastHi = { i: pivotIndex, price: prepared.h[pivotIndex], broken: false };
    }
    while (lowPointer < prepared.piv.lo.length && prepared.piv.lo[lowPointer] <= i - confirmationBars) {
      const pivotIndex = prepared.piv.lo[lowPointer++];
      lastLo = { i: pivotIndex, price: prepared.l[pivotIndex], broken: false };
    }
    if (lastHi && !lastHi.broken && prepared.c[i] > lastHi.price) {
      events.push({ type: trend === -1 ? "CHoCH" : "BOS", dir: 1, level: lastHi.price, i, from: lastHi.i });
      trend = 1;
      lastHi.broken = true;
    }
    if (lastLo && !lastLo.broken && prepared.c[i] < lastLo.price) {
      events.push({ type: trend === 1 ? "CHoCH" : "BOS", dir: -1, level: lastLo.price, i, from: lastLo.i });
      trend = -1;
      lastLo.broken = true;
    }
  }
  return { events, trend, lastHi, lastLo };
}
