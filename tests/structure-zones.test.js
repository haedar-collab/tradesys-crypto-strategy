import test from "node:test";
import assert from "node:assert/strict";
import { findBullishOrderBlocks, findBullishFvgs, findLiquidityLevels } from "../src/structure/zones.js";

function series({ o, h, l, c, piv = { hi: [], lo: [] } }) {
  const n = c.length;
  return { n, t: Array.from({ length: n }, (_, i) => i * 60_000), o, h, l, c, piv };
}

test("finds a valid bullish order block and records retests", () => {
  const p = series({
    o: [10, 10, 8, 10, 12, 12, 12, 12],
    h: [11, 11, 10, 12, 13, 13, 13, 13],
    l: [8, 7, 6, 9, 11, 10, 9, 8],
    c: [9, 9, 9, 11, 12, 12, 12, 12]
  });
  const zones = findBullishOrderBlocks(p, [{ dir: 1, type: "BOS", from: 1, i: 4 }]);
  assert.equal(zones.length, 1);
  assert.deepEqual(zones[0], { lo: 7, hi: 10, t: 60_000, idx: 1, event: "BOS", tests: 3, originLow: 6, from: 5 });
});

test("invalidates bullish order block after a close below its low", () => {
  const p = series({
    o: [10, 10, 8, 10, 12, 12, 12, 12],
    h: [11, 11, 10, 12, 13, 13, 13, 13],
    l: [8, 7, 6, 9, 11, 10, 6, 8],
    c: [9, 9, 9, 11, 12, 12, 6, 12]
  });
  const event = [{ dir: 1, type: "BOS", from: 1, i: 4 }];
  assert.equal(findBullishOrderBlocks(series({o:p.o.slice(0,5),h:p.h.slice(0,5),l:p.l.slice(0,5),c:p.c.slice(0,5)}),event).length,1,
    "the order block exists before the later invalidation candle");
  assert.deepEqual(findBullishOrderBlocks(p, event), [], "the later close invalidates it only from that point onward");
});

test("tracks partial FVG fill and excludes a fully filled gap", () => {
  const partial = series({
    o: [10, 10, 12, 12, 12],
    h: [10, 11, 13, 13, 13],
    l: [9, 10, 12, 11.5, 11],
    c: [10, 11, 12.5, 12, 12]
  });
  const prefix = series({o:partial.o.slice(0,4),h:partial.h.slice(0,4),l:partial.l.slice(0,4),c:partial.c.slice(0,4)});
  assert.deepEqual(findBullishFvgs(prefix), [
    { lo: 10, hi: 11.5, t: 120_000, idx: 2 },
    { lo: 11, hi: 11.5, t: 180_000, idx: 3 }
  ]);
  assert.deepEqual(findBullishFvgs(partial), [{ lo: 10, hi: 11, t: 120_000, idx: 2 }]);
  partial.l[4] = 9;
  assert.deepEqual(findBullishFvgs(partial), [], "future fill removes the FVG from the later snapshot, not the earlier one");
});

test("detects equal highs, sell-side liquidity, and sweep-and-reclaim", () => {
  const p = series({
    o: Array(12).fill(100),
    h: [102, 103, 110, 104, 111, 103, 102, 102, 102, 102, 102, 102],
    l: [98, 97, 95, 90, 88, 89, 87, 95, 96, 96, 96, 96],
    c: [100, 100, 100, 100, 92, 100, 90, 100, 100, 100, 100, 100],
    piv: { hi: [2, 4], lo: [3, 5] }
  });
  const result = findLiquidityLevels(p, 100, 10, { lookback: 160, sweepLookback: 60, toleranceAtr: 0.15 });
  assert.deepEqual(result.buySideLiquidity, [{ px: 110, eq: true, t: 120_000 }]);
  assert.deepEqual(result.sellSideLiquidity, [{ px: 90, t: 180_000 }, { px: 89, t: 300_000 }]);
  assert.deepEqual(result.sweep, { px: 89, at: 360_000 });
});
