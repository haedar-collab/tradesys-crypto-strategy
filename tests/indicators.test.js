import test from "node:test";
import assert from "node:assert/strict";
import { sma, ema, wilder, rsi, trueRange, atr, adx, bbands, obv, pivotsAll, pctRank, prepareIndicators } from "../src/indicators/index.js";

const close = Array.from({ length: 40 }, (_, i) => 100 + i);
const high = close.map(v => v + 2), low = close.map(v => v - 2), volume = close.map((_, i) => 1000 + i);

test("SMA and EMA preserve warm-up and seeded values", () => {
  assert.deepEqual(sma([1, 2, 3, 4], 3), [null, null, 2, 3]);
  assert.deepEqual(ema([1, 2, 3, 4], 3), [null, null, 2, 3]);
});

test("Wilder smoothing seeds with period average", () => {
  assert.deepEqual(wilder([1, 2, 3, 4], 3), [null, null, 2, 2 + 2 / 3]);
});

test("RSI handles monotonic gains and losses", () => {
  const up = rsi(close, 14), down = rsi(close.map(v => -v), 14);
  assert.equal(up[14], 100);
  assert.equal(down[14], 0);
});

test("ATR, ADX, Bollinger Bands and OBV return aligned arrays", () => {
  assert.equal(atr(high, low, close, 14).length, close.length);
  assert.equal(adx(high, low, close, 14).length, close.length);
  assert.equal(bbands(close, 20).length, close.length);
  assert.equal(obv(close, volume).length, close.length);
  assert.equal(bbands(close, 20)[18], null);
});

test("pivots preserve legacy numeric index arrays", () => {
  const h = [1, 2, 5, 3, 2, 1, 2, 3, 2], l = [0, 1, 2, 1, 0, -1, 0, 1, 2];
  const pivots = pivotsAll(h, l, 2);
  assert.deepEqual(pivots.hi, [2]);
  assert.deepEqual(pivots.lo, [5]);
});

test("percentile rank and prepareIndicators output are deterministic", () => {
  assert.equal(pctRank([1, 2, 3, 4], 3, 4), 100);
  const prepared = prepareIndicators({ h: high, l: low, c: close, v: volume }, { emaFast: 5, emaMid: 10, emaSlow: 20 });
  assert.equal(prepared.e20.length, close.length);
  assert.equal(prepared.e20[4], 102);
  assert.equal(prepared.n, close.length);
});
