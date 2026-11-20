/**
 * Bullish SMC zone and liquidity primitives extracted from Tradesys Crypto.
 * These helpers are pure and consume prepared closed-candle series plus
 * confirmed structure events. Zone selection and signal decisions stay higher-level.
 */

function validateSeries(p) {
  if (!p || !Number.isInteger(p.n) || p.n < 0 ||
      !["t", "o", "h", "l", "c"].every(key => Array.isArray(p[key]) && p[key].length === p.n)) {
    throw new TypeError("prepared series must contain aligned t/o/h/l/c arrays and n");
  }
}

export function findBullishOrderBlocks(p, events, lookback = 150) {
  validateSeries(p);
  if (!Array.isArray(events)) throw new TypeError("events must be an array");
  if (!Number.isInteger(lookback) || lookback < 1) throw new RangeError("lookback must be a positive integer");
  const zones = [];
  for (const event of events.filter(item => item.dir === 1 && item.i > p.n - lookback)) {
    let lowest = event.from;
    for (let i = event.from; i <= event.i; i++) if (p.l[i] < p.l[lowest]) lowest = i;
    let origin = lowest;
    for (let i = lowest; i >= Math.max(0, lowest - 5); i--) {
      if (p.c[i] < p.o[i]) { origin = i; break; }
    }
    const lo = p.l[origin];
    const hi = p.c[origin] < p.o[origin] ? p.o[origin] : Math.max(p.o[origin], p.c[origin]);
    let broken = false, tests = 0;
    for (let i = event.i + 1; i < p.n; i++) {
      if (p.c[i] < lo) { broken = true; break; }
      if (p.l[i] <= hi) tests++;
    }
    if (!broken && hi > lo) {
      zones.push({ lo, hi, t: p.t[origin], idx: origin, event: event.type, tests, originLow: p.l[lowest], from: event.i + 1 });
    }
  }
  return zones;
}

export function findBullishFvgs(p, lookback = 80) {
  validateSeries(p);
  if (!Number.isInteger(lookback) || lookback < 1) throw new RangeError("lookback must be a positive integer");
  const zones = [];
  for (let i = Math.max(2, p.n - lookback); i < p.n; i++) {
    if (p.l[i] <= p.h[i - 2]) continue;
    const lo = p.h[i - 2];
    let hi = p.l[i], filled = false;
    for (let j = i + 1; j < p.n; j++) {
      if (p.l[j] <= lo) { filled = true; break; }
      hi = Math.min(hi, p.l[j]);
    }
    if (!filled && hi > lo) zones.push({ lo, hi, t: p.t[i], idx: i });
  }
  return zones;
}

export function findLiquidityLevels(p, currentPrice, atr, options = {}) {
  validateSeries(p);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(atr) || atr <= 0) {
    throw new RangeError("currentPrice and atr must be positive finite numbers");
  }
  const lookback = options.lookback ?? 160;
  const sweepLookback = options.sweepLookback ?? 60;
  const toleranceAtr = options.toleranceAtr ?? 0.15;
  if (![lookback, sweepLookback].every(value => Number.isInteger(value) && value > 0) ||
      !Number.isFinite(toleranceAtr) || toleranceAtr < 0) throw new RangeError("invalid liquidity options");

  const i = p.n - 1;
  const hi = p.piv?.hi, lo = p.piv?.lo;
  if (!Array.isArray(hi) || !Array.isArray(lo)) throw new TypeError("prepared series must include numeric pivot arrays { hi, lo }");
  const confirmedHighs = hi.filter(index => index <= i - 3 && index > p.n - lookback)
    .map(index => ({ px: p.h[index], i: index }))
    .filter(level => level.px > currentPrice && !p.c.slice(level.i + 1).some(close => close > level.px))
    .sort((a, b) => a.px - b.px);
  const buySideLiquidity = [];
  for (const high of confirmedHighs) {
    const equal = confirmedHighs.some(other => other !== high && Math.abs(other.px - high.px) <= toleranceAtr * atr);
    if (!buySideLiquidity.some(level => Math.abs(level.px - high.px) <= toleranceAtr * atr)) {
      buySideLiquidity.push({ px: high.px, eq: equal, t: p.t[high.i] });
    }
  }

  const sellSideLiquidity = lo.filter(index => index <= i - 3 && index > p.n - lookback)
    .map(index => ({ px: p.l[index], i: index }))
    .filter(level => level.px < currentPrice)
    .sort((a, b) => b.px - a.px);

  let sweep = null;
  for (const pivotIndex of lo.filter(index => index <= i - 3 && index > p.n - sweepLookback)) {
    for (let j = Math.max(pivotIndex + 1, p.n - 10); j < p.n; j++) {
      if (p.l[j] < p.l[pivotIndex] && p.c[j] > p.l[pivotIndex]) {
        sweep = { px: p.l[pivotIndex], at: p.t[j] };
      }
    }
  }
  return {
    buySideLiquidity: buySideLiquidity.slice(0, 4),
    sellSideLiquidity: sellSideLiquidity.slice(0, 3).map(level => ({ px: level.px, t: p.t[level.i] })),
    sweep
  };
}
