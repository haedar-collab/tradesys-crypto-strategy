import test from "node:test";
import assert from "node:assert/strict";
import { createBinanceSpotMtfScreenerProvider } from "../src/data/binance-spot-mtf-screener-provider.js";

test("runtime screener provider caches results across dashboard polls", async () => {
  let time = 2_000_000_000_000;
  const calls = [];
  const provider = createBinanceSpotMtfScreenerProvider({
    symbols: ["BTCUSDT", "ETHUSDT"],
    now: () => time,
    refreshIntervalMs: 60_000,
    fetchKlines: async request => {
      calls.push(request);
      return { bars: [] };
    }
  });
  const first = await provider();
  assert.equal(first.screener.status, "COMPLETE");
  assert.equal(first.screener.symbolCount, 2);
  assert.equal(first.screener.waitCount, 2);
  assert.equal(first.signal.decision, "WAIT");
  assert.equal(calls.length, 8);
  await provider();
  assert.equal(calls.length, 8);
  time += 60_001;
  await provider();
  assert.equal(calls.length, 16);
  assert.ok(calls.every(call => call.startTime < call.endTime));
  assert.equal(calls.some(call => call.interval === "1w"), true);
  assert.equal(calls.some(call => call.interval === "1h"), true);
});

test("runtime screener provider rejects invalid refresh configuration", () => {
  assert.throws(() => createBinanceSpotMtfScreenerProvider({
    symbols: ["BTCUSDT"], refreshIntervalMs: 100
  }), /at least 5000/);
});
