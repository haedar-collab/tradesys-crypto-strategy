import test from "node:test";
import assert from "node:assert/strict";
import { computeRelativeStrength, rankRelativeStrength } from "../src/relative-strength/index.js";

function makeSeries(length, growth, offset = 0) {
  return {
    t: Array.from({ length }, (_, i) => (i + offset) * 86_400_000),
    c: Array.from({ length }, (_, i) => 100 * Math.pow(1 + growth, i))
  };
}

test("computes positive relative strength for an asset outperforming BTC", () => {
  const result = computeRelativeStrength(makeSeries(120, 0.012), makeSeries(120, 0.006));
  assert.equal(result.status, "PASS");
  assert.ok(result.d7 > 0);
  assert.ok(result.d30 > 0);
  assert.ok(result.d90 > 0);
  assert.ok(result.score > 0);
  assert.ok(result.score5 > 0);
  assert.equal(result.ratioUp, true);
});

test("returns WAIT_DATA when there is insufficient aligned history", () => {
  const result = computeRelativeStrength(makeSeries(60, 0.01), makeSeries(60, 0.005));
  assert.equal(result.status, "WAIT_DATA");
  assert.equal(result.reason, "INSUFFICIENT_ALIGNED_HISTORY");
});

test("does not compare different as-of dates", () => {
  const result = computeRelativeStrength(makeSeries(120, 0.01), makeSeries(119, 0.005));
  assert.equal(result.status, "WAIT_DATA");
  assert.equal(result.reason, "AS_OF_MISMATCH");
});

test("ranks the universe deterministically and applies top percentile", () => {
  const ranked = rankRelativeStrength([
    { symbol: "AAAUSDT", status: "PASS", score: 2 },
    { symbol: "BBBUSDT", status: "PASS", score: 4 },
    { symbol: "CCCUSDT", status: "PASS", score: 1 },
    { symbol: "BADUSDT", status: "WAIT_DATA", score: 100 }
  ], 34);
  assert.deepEqual(ranked.map(item => item.symbol), ["BBBUSDT", "AAAUSDT", "CCCUSDT"]);
  assert.deepEqual(ranked.map(item => item.top), [true, true, false]);
  assert.deepEqual(ranked.map(item => item.rank), [1, 2, 3]);
});

test("preserves incoming volume order when relative-strength scores tie", () => {
  const ranked = rankRelativeStrength([
    { symbol: "HIGHVOL", status: "PASS", score: 5 },
    { symbol: "LOWVOL", status: "PASS", score: 5 }
  ], 50);
  assert.deepEqual(ranked.map(item => item.symbol), ["HIGHVOL", "LOWVOL"]);
});

test("returns WAIT_DATA when aligned daily history contains a missing interval",()=>{
 const asset=makeSeries(120,0.01), benchmark=makeSeries(120,0.005);
 asset.t.splice(70,1);asset.c.splice(70,1);
 const result=computeRelativeStrength(asset,benchmark);
 assert.equal(result.status,"WAIT_DATA");
 assert.equal(result.reason,"HISTORY_GAP");
});

test("allows an explicitly configured daily interval",()=>{
 const asset=makeSeries(120,0.01), benchmark=makeSeries(120,0.005);
 const result=computeRelativeStrength(asset,benchmark,{expectedIntervalMs:86_400_000});
 assert.equal(result.status,"PASS");
});
