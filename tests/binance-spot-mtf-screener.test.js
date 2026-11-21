import test from "node:test";
import assert from "node:assert/strict";
import { runBinanceSpotMtfScreener } from "../src/screener/binance-spot-mtf-screener.js";

const symbols = ["BTCUSDT", "ETHUSDT"];
const timeframes = ["1w", "1d", "4h", "1h"];
function bars(count = 8, now = 2_000_000_000_000) {
  return Array.from({ length: count }, (_, i) => ({
    t: now - (count - i) * 3_600_000,
    closeTime: now - (count - i) * 3_600_000 + 3_599_999,
    o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 10
  }));
}

test("screener requests all four causal intervals per symbol and reports WAIT for insufficient history", async () => {
  const calls = [];
  const report = await runBinanceSpotMtfScreener({
    symbols, evaluationTime: 2_000_000_000_000,
    fetchKlines: async request => { calls.push(request); return bars(); }
  });
  assert.equal(calls.length, 8);
  assert.deepEqual(new Set(calls.map(call => call.interval)), new Set(timeframes));
  assert.equal(report.status, "COMPLETE");
  assert.equal(report.mode, "SPOT_SIGNAL_ONLY");
  assert.equal(report.candidateCount, 0);
  assert.equal(report.waitCount, 2);
  for (const item of report.results) {
    assert.equal(item.state, "WAIT");
    assert.equal(item.candidate.candidate, false);
    assert.ok(item.candidate.reasons.includes("TIMEFRAME_NOT_READY"));
  }
  assert.equal(report.controls.noExchangeOrders, true);
});

test("one symbol data failure is isolated and never converted into a candidate", async () => {
  const report = await runBinanceSpotMtfScreener({
    symbols, evaluationTime: 2_000_000_000_000,
    fetchKlines: async ({ symbol, interval }) => {
      if (symbol === "ETHUSDT" && interval === "4h") throw new Error("rate limited");
      return bars();
    }
  });
  assert.equal(report.status, "PARTIAL");
  assert.equal(report.dataErrorCount, 1);
  const failed = report.results.find(item => item.symbol === "ETHUSDT");
  assert.equal(failed.state, "DATA_ERROR");
  assert.equal(failed.candidate.candidate, false);
  assert.deepEqual(failed.candidate.reasons, ["SCREENER_DATA_UNAVAILABLE"]);
});

test("rejects invalid symbols, duplicates, and missing fetch function", async () => {
  await assert.rejects(() => runBinanceSpotMtfScreener({ symbols: ["btc"], fetchKlines: async () => [] }), /unique uppercase/);
  await assert.rejects(() => runBinanceSpotMtfScreener({ symbols: ["BTCUSDT", "BTCUSDT"], fetchKlines: async () => [] }), /unique uppercase/);
  await assert.rejects(() => runBinanceSpotMtfScreener({ symbols }), /fetchKlines/);
});
