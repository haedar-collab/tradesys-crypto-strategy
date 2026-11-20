/**
 * Pure technical indicators.
 * The seed and warm-up behavior intentionally mirrors the frozen Tradesys
 * implementation for valid complete arrays. Null values represent warm-up.
 */

function assertPeriod(period) {
  if (!Number.isInteger(period) || period < 1) throw new RangeError("period must be a positive integer");
}

function assertNumericArray(values, name = "values") {
  if (!Array.isArray(values)) throw new TypeError(`${name} must be an array`);
  for (let i = 0; i < values.length; i++) {
    if (values[i] != null && !Number.isFinite(values[i])) throw new TypeError(`${name}[${i}] must be finite or null`);
  }
}

export function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function sma(values, period) {
  assertPeriod(period); assertNumericArray(values);
  const out = []; let sum = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) { out.push(null); continue; }
    sum += values[i];
    if (i >= period) {
      if (values[i - period] == null) {
        sum = 0;
        const start = i - period + 1;
        for (let j = start; j <= i; j++) sum += values[j] ?? 0;
      } else sum -= values[i - period];
    }
    const window = values.slice(Math.max(0, i - period + 1), i + 1);
    out.push(window.length < period || window.some(v => v == null) ? null : sum / period);
  }
  return out;
}

export function ema(values, period) {
  assertPeriod(period); assertNumericArray(values);
  const k = 2 / (period + 1), out = [];
  let previous = null;
  for (let i = 0; i < values.length; i++) {
    if (values[i] == null) { out.push(null); continue; }
    if (i < period - 1) { out.push(null); continue; }
    if (previous === null) {
      const seed = values.slice(i - period + 1, i + 1);
      if (seed.length !== period || seed.some(v => v == null)) { out.push(null); continue; }
      previous = average(seed);
    } else previous = values[i] * k + previous * (1 - k);
    out.push(previous);
  }
  return out;
}

export function wilder(values, period) {
  assertPeriod(period); assertNumericArray(values);
  const out = []; let previous = null; const buffer = [];
  for (const value of values) {
    if (value == null) { out.push(null); continue; }
    if (previous === null) {
      buffer.push(value);
      if (buffer.length < period) { out.push(null); continue; }
      previous = average(buffer);
    } else previous = (previous * (period - 1) + value) / period;
    out.push(previous);
  }
  return out;
}

export function rsi(close, period = 14) {
  assertPeriod(period); assertNumericArray(close, "close");
  const gains = [null], losses = [null];
  for (let i = 1; i < close.length; i++) {
    if (close[i] == null || close[i - 1] == null) { gains.push(null); losses.push(null); continue; }
    const delta = close[i] - close[i - 1];
    gains.push(Math.max(delta, 0)); losses.push(Math.max(-delta, 0));
  }
  const avgGain = wilder(gains, period), avgLoss = wilder(losses, period);
  return close.map((_, i) => {
    if (avgGain[i] == null) return null;
    if (avgLoss[i] === 0) return 100;
    if (avgGain[i] === 0) return 0;
    return 100 - 100 / (1 + avgGain[i] / avgLoss[i]);
  });
}

export function trueRange(high, low, close) {
  assertNumericArray(high, "high"); assertNumericArray(low, "low"); assertNumericArray(close, "close");
  if (high.length !== low.length || high.length !== close.length) throw new RangeError("OHLC arrays must have equal lengths");
  return high.map((h, i) => {
    if (h == null || low[i] == null || close[i] == null || (i > 0 && close[i - 1] == null)) return null;
    return i === 0 ? h - low[i] : Math.max(h - low[i], Math.abs(h - close[i - 1]), Math.abs(low[i] - close[i - 1]));
  });
}

export function atr(high, low, close, period = 14) {
  return wilder(trueRange(high, low, close), period);
}

export function adx(high, low, close, period = 14) {
  assertPeriod(period);
  if (high.length !== low.length || high.length !== close.length) throw new RangeError("OHLC arrays must have equal lengths");
  const plusDm = [null], minusDm = [null];
  for (let i = 1; i < high.length; i++) {
    if ([high[i], high[i - 1], low[i], low[i - 1]].some(v => v == null)) {
      plusDm.push(null); minusDm.push(null); continue;
    }
    const up = high[i] - high[i - 1], down = low[i - 1] - low[i];
    plusDm.push(up > down && up > 0 ? up : 0);
    minusDm.push(down > up && down > 0 ? down : 0);
  }
  const tr = trueRange(high, low, close);
  if (tr.length) tr[0] = null;
  const smoothTr = wilder(tr, period), smoothPlus = wilder(plusDm, period), smoothMinus = wilder(minusDm, period);
  const dx = close.map((_, i) => {
    if (smoothTr[i] == null || smoothTr[i] === 0 || smoothPlus[i] == null || smoothMinus[i] == null) return null;
    const plusDi = 100 * smoothPlus[i] / smoothTr[i], minusDi = 100 * smoothMinus[i] / smoothTr[i];
    return plusDi + minusDi === 0 ? 0 : 100 * Math.abs(plusDi - minusDi) / (plusDi + minusDi);
  });
  return wilder(dx, period);
}

export function bbands(close, period = 20, multiplier = 2) {
  assertPeriod(period);
  if (!Number.isFinite(multiplier) || multiplier < 0) throw new RangeError("multiplier must be non-negative and finite");
  assertNumericArray(close, "close");
  const mid = sma(close, period);
  return close.map((value, i) => {
    if (mid[i] == null) return null;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += (close[j] - mid[i]) ** 2;
    const sd = Math.sqrt(sum / period);
    return { mid: mid[i], up: mid[i] + multiplier * sd, lo: mid[i] - multiplier * sd, width: mid[i] === 0 ? null : (2 * multiplier * sd) / mid[i] };
  });
}

export function obv(close, volume) {
  assertNumericArray(close, "close"); assertNumericArray(volume, "volume");
  if (close.length !== volume.length) throw new RangeError("close and volume arrays must have equal lengths");
  if (!close.length) return [];
  const out = [0];
  for (let i = 1; i < close.length; i++) {
    if (close[i] == null || close[i - 1] == null || volume[i] == null) { out.push(null); continue; }
    const previous = out[i - 1];
    if (previous == null) { out.push(null); continue; }
    out.push(previous + (close[i] > close[i - 1] ? volume[i] : close[i] < close[i - 1] ? -volume[i] : 0));
  }
  return out;
}

export function pivotsAll(high, low, leftRight = 3) {
  assertPeriod(leftRight);
  assertNumericArray(high, "high"); assertNumericArray(low, "low");
  if (high.length !== low.length) throw new RangeError("high and low arrays must have equal lengths");
  const highs = [], lows = [];
  for (let i = leftRight; i < high.length - leftRight; i++) {
    if (high[i] == null || low[i] == null) continue;
    let isHigh = true, isLow = true;
    for (let j = i - leftRight; j <= i + leftRight; j++) {
      if (j === i) continue;
      if (high[j] == null || low[j] == null) { isHigh = false; isLow = false; break; }
      if (high[j] >= high[i]) isHigh = false;
      if (low[j] <= low[i]) isLow = false;
    }
    if (isHigh) highs.push({ index: i, availableAt: i + leftRight });
    if (isLow) lows.push({ index: i, availableAt: i + leftRight });
  }
  return { highs, lows };
}

export function pctRank(values, index, window) {
  assertPeriod(window); assertNumericArray(values);
  if (!Number.isInteger(index) || index < 0 || index >= values.length) throw new RangeError("index out of range");
  if (values[index] == null) return null;
  let count = 0, lessOrEqual = 0;
  for (let i = Math.max(0, index - window + 1); i <= index; i++) {
    if (values[i] == null) continue;
    count++;
    if (values[i] <= values[index]) lessOrEqual++;
  }
  return count ? 100 * lessOrEqual / count : null;
}

export function prepareIndicators(series, parameters = {}) {
  const { h, l, c, v } = series ?? {};
  if (![h, l, c, v].every(Array.isArray) || ![h, l, c, v].every(a => a.length === c.length)) {
    throw new TypeError("series must contain equal-length h, l, c, and v arrays");
  }
  const emaFast = parameters.emaFast ?? 20;
  const emaMid = parameters.emaMid ?? 50;
  const emaSlow = parameters.emaSlow ?? 200;
  const bands = bbands(c);
  const averageTrueRange = atr(h, l, c);
  return {
    ...series,
    n: c.length,
    e20: ema(c, emaFast),
    e50: ema(c, emaMid),
    e200: ema(c, emaSlow),
    rsi: rsi(c),
    atr: averageTrueRange,
    adx: adx(h, l, c),
    bb: bands,
    bbw: bands.map(item => item?.width ?? null),
    atrp: averageTrueRange.map((value, i) => value == null || c[i] == null || c[i] === 0 ? null : value / c[i]),
    obv: obv(c, v),
    vsma: sma(v, 20),
    piv: pivotsAll(h, l, 3)
  };
}
