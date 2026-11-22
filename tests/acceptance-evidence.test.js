import test from "node:test";
import assert from "node:assert/strict";
import {
  closedWindow, replayCandidates, chronologicalFolds, accountTradeReturns,
  assessDataQuality, aggregateBacktests, candidatesToSignals, buildAcceptanceEvidence
} from "../src/validation/acceptance-evidence.js";
import { evaluateStrategyAcceptance } from "../src/validation/strategy-acceptance.js";

const H = 3_600_000, D = 24 * H, W = 7 * D;
function series(step, count, endOpen, priceAt) {
  return Array.from({ length: count }, (_, i) => {
    const openTime = endOpen - (count - 1 - i) * step;
    const close = priceAt(openTime);
    return { openTime, closeTime: openTime + step - 1, open: close * 0.999, high: close * 1.006, low: close * 0.994, close, volume: 1000 };
  });
}
// Rising trend with a multi-week drawdown, so daily-level gates both pass and block.
const price = t => { const d = t / D; return 100 * Math.exp(d * 0.0015) * (1 + 0.08 * Math.sin(d / 9)) + 3 * Math.sin(t / (5 * H)); };
const END = Date.UTC(2026, 0, 5);
const timeframes = {
  weekly: series(W, 260, Date.UTC(2025, 11, 29), price),
  daily: series(D, 1000, END - D, price),
  h4: series(4 * H, 900, END - 4 * H, price),
  h1: series(H, 2400, END - H, price)
};

test("closedWindow only returns candles closed strictly before t, newest last", () => {
  const h1 = timeframes.h1;
  const t = h1[100].closeTime + 1;
  const w = closedWindow(h1, t, 10);
  assert.equal(w.length, 10);
  assert.equal(w.at(-1), h1[100]);
  assert.ok(w.every(c => c.closeTime < t));
  assert.equal(closedWindow(h1, h1[100].closeTime, 10).at(-1), h1[99], "a candle closing at t is excluded");
});

// A long uptrend that turns into a decline: daily-level gates start blocking.
const turning = t => { const d = t / D, peak = END / D - 120;
  return (d < peak ? 100 * Math.exp((d - peak) * 0.002) : 100 * Math.exp(-(d - peak) * 0.004)) * (1 + 0.01 * Math.sin(t / (7 * H))); };
const turningTimeframes = {
  weekly: series(W, 260, Date.UTC(2025, 11, 29), turning),
  daily: series(D, 1000, END - D, turning),
  h4: series(4 * H, 900, END - 4 * H, turning),
  h1: series(H, 2400, END - H, turning)
};

for (const [name, tf] of [["trending", timeframes], ["turning", turningTimeframes]]) {
  test("daily-gate shortcut is exact (" + name + " market): identical candidates and reason counts", () => {
    const start = tf.h1[1500].openTime, end = tf.h1[2300].openTime;
    const fast = replayCandidates(tf, { start, end });
    const slow = replayCandidates(tf, { start, end, skipDailyGates: false });
    assert.deepEqual(fast.decisions, slow.decisions);
    assert.deepEqual(fast.stats.reasons, slow.stats.reasons);
    assert.equal(fast.stats.evaluations, slow.stats.evaluations);
    assert.equal(slow.stats.skippedByDailyGate, 0);
    if (name === "turning") {
      assert.ok(fast.stats.skippedByDailyGate > 0, "the shortcut must actually be exercised: " + JSON.stringify(fast.stats));
    }
  });
}

test("chronological folds are contiguous and cover the whole period", () => {
  const folds = chronologicalFolds(0, 100 * H + 5, 4);
  assert.equal(folds.length, 4);
  assert.equal(folds[0].from, 0);
  assert.equal(folds.at(-1).to, 100 * H + 5);
  for (let i = 1; i < folds.length; i++) assert.equal(folds[i].from, folds[i - 1].to);
  assert.throws(() => chronologicalFolds(0, 1, 0), /positive integer/);
});

test("account trade returns compound on equity before each trade", () => {
  const r = accountTradeReturns({ trades: [{ netPnl: 100, entryTime: 1, exitTime: 2 }, { netPnl: -101, entryTime: 3, exitTime: 4 }] }, 10_000);
  assert.equal(r[0].accountReturn, 0.01);
  assert.equal(r[1].accountReturn, -101 / 10_100);
});

test("data-quality policy passes rare short outages and fails long gaps or duplicates", () => {
  const base = series(H, 2000, Date.UTC(2026, 0, 1), () => 100);
  const shortGap = base.filter((_, i) => i !== 500);
  const longGap = base.filter((_, i) => i < 500 || i > 530);
  const dup = [...base.slice(0, 10), base[9], ...base.slice(10)];
  const run = candles => assessDataQuality([{ symbol: "X", interval: "1h", candles, from: 0, to: Infinity }]);
  assert.equal(run(shortGap).status, "PASS");
  const long = run(longGap);
  assert.equal(long.status, "FAIL");
  assert.equal(long.checks[0].longestGapHours, 31);
  assert.equal(run(dup).status, "FAIL");
});

test("aggregate uses equal-weight returns, worst drawdown and currency profit factor", () => {
  const agg = aggregateBacktests([
    { symbol: "A", backtest: { netReturnPct: 10, maxDrawdownPct: 5, trades: [{ netPnl: 300 }, { netPnl: -100 }] } },
    { symbol: "B", backtest: { netReturnPct: -2, maxDrawdownPct: 8, trades: [{ netPnl: -100 }] } },
    { symbol: "C", backtest: null }
  ]);
  assert.equal(agg.symbolCount, 2);
  assert.equal(agg.tradeCount, 3);
  assert.equal(agg.netReturnPct, 4);
  assert.equal(agg.maxDrawdownPct, 8);
  assert.equal(agg.profitFactor, 1.5);
});

test("signals map to the bar that closed at evaluation time and reject invalid plans", () => {
  const h1 = timeframes.h1.slice(0, 10);
  const plan = { entry: 100, stop: 95, tp1: 105, tp2: 110, tp3: 115 };
  const signals = candidatesToSignals(h1, [
    { evaluationTime: h1[3].closeTime + 1, plan },
    { evaluationTime: h1[9].closeTime + 1, plan },
    { evaluationTime: h1[4].closeTime + 1, plan: { ...plan, tp2: 104 } }
  ]);
  assert.deepEqual(signals.map(s => s.index), [3]);
});

test("end-to-end evidence bundle fits the acceptance contract (underpowered sample is not accepted)", () => {
  const start = timeframes.h1[1500].openTime, end = timeframes.h1.at(-1).openTime;
  const { decisions } = replayCandidates(timeframes, { start, end });
  const evidence = buildAcceptanceEvidence({
    symbols: [{ symbol: "SYNTH", h1: timeframes.h1, decisions }], start, end, folds: 3,
    benchmarkDaily: timeframes.daily,
    dataQuality: assessDataQuality([{ symbol: "SYNTH", interval: "1h", candles: timeframes.h1, from: start, to: end }])
  });
  assert.equal(evidence.dataQuality.status, "PASS");
  assert.equal(evidence.walkForward.folds.length, 3);
  assert.ok(Array.isArray(evidence.regimeAnalysis.groups));
  const decision = evaluateStrategyAcceptance(evidence);
  assert.notEqual(decision.decision, "ACCEPT", "a few weeks of one synthetic symbol can never be accepted");
});
