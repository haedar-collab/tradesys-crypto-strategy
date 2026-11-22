import test from "node:test";
import assert from "node:assert/strict";
import { runBinanceSpotMtfScreener, BINANCE_SPOT_SCREENER_LOOKBACK_BARS } from "../src/screener/binance-spot-mtf-screener.js";
import { createBinanceSpotMtfScreenerProvider } from "../src/data/binance-spot-mtf-screener-provider.js";
import { buildCausalMultiTimeframeContext, CAUSAL_MTF_INTERVALS } from "../src/engine/causal-mtf.js";
import { ema } from "../src/indicators/index.js";

const MS = { "1w": 604_800_000, "1d": 86_400_000, "4h": 14_400_000, "1h": 3_600_000 };

test("#9 weekly and daily frames request enough history for EMA200 to converge", async () => {
  assert.ok(BINANCE_SPOT_SCREENER_LOOKBACK_BARS.weekly >= 1000);
  assert.ok(BINANCE_SPOT_SCREENER_LOOKBACK_BARS.daily >= 1000);
  const evaluationTime = Date.UTC(2026, 10, 22);
  const requests = [];
  await runBinanceSpotMtfScreener({
    symbols: ["BTCUSDT"], evaluationTime,
    fetchKlines: async request => { requests.push(request); return []; }
  });
  const bars = interval => {
    const r = requests.find(x => x.interval === interval);
    return (r.endTime - r.startTime) / MS[interval];
  };
  assert.equal(bars("1w"), 1000);
  assert.equal(bars("1d"), 1000);
  assert.equal(bars("4h"), 230);
  assert.equal(bars("1h"), 230);
});

test("#9 the dashboard screener provider uses the same lookback windows", async () => {
  const requests = [];
  const evaluationTime = Date.UTC(2026, 10, 22);
  const provider = createBinanceSpotMtfScreenerProvider({
    symbols: ["BTCUSDT"], now: () => evaluationTime,
    fetchKlines: async request => { requests.push(request); return { bars: [] }; }
  });
  await provider();
  for (const r of requests) {
    const expected = { "1w": 1000, "1d": 1000, "4h": 230, "1h": 230 }[r.interval];
    assert.equal((r.endTime - r.startTime) / MS[r.interval], expected, r.interval);
  }
});

test("#9 EMA200 from a 1000-bar window no longer depends on where the window starts", () => {
  // Deterministic random walk (seed 7) where the 230-bar seed bias is visible;
  // the size of that bias is path-dependent, the 1000-bar convergence is not.
  let x = 100, seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  const series = Array.from({ length: 1600 }, () => (x *= 1 + rnd() * 0.06));
  const reference = ema(series, 200).at(-1);
  const deviation = n => Math.abs(ema(series.slice(-n), 200).at(-1) / reference - 1);
  assert.ok(deviation(230) > 0.005, "the old 230-bar window is materially seed-dependent");
  assert.ok(deviation(1000) < 0.0005, "1000 bars converge");
});

test("#9 causal context diagnostics report EMA200 convergence per frame", () => {
  const now = Date.UTC(2026, 10, 20, 12, 0, 0);
  const series = (key, count, interval) => {
    let anchor;
    if (key === "weekly") {
      const d = new Date(now); const day = (d.getUTCDay() + 6) % 7;
      anchor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * 86400000 - interval;
    } else if (key === "daily") {
      anchor = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()) - interval;
    } else anchor = Math.floor(now / interval) * interval - interval;
    return Array.from({ length: count }, (_, i) => {
      const openTime = anchor - (count - 1 - i) * interval;
      const close = 100 + i * .08 + Math.sin(i / 6);
      return { openTime, closeTime: openTime + interval - 1, open: close - .1, high: close + .7, low: close - .7, close, volume: 1000 };
    });
  };
  const built = buildCausalMultiTimeframeContext({
    weekly: series("weekly", 230, CAUSAL_MTF_INTERVALS.weekly),
    daily: series("daily", 1000, CAUSAL_MTF_INTERVALS.daily),
    h4: series("h4", 90, CAUSAL_MTF_INTERVALS.h4),
    h1: series("h1", 90, CAUSAL_MTF_INTERVALS.h1)
  }, { evaluationTime: now });
  assert.equal(built.status, "READY");
  assert.equal(built.diagnostics.weekly.bars, 230);
  assert.equal(built.diagnostics.weekly.ema200Converged, false);
  assert.ok(built.diagnostics.weekly.ema200SeedWeight > 0.7);
  assert.equal(built.diagnostics.daily.ema200Converged, true);
  assert.ok(built.diagnostics.daily.ema200SeedWeight < 0.001);
});
