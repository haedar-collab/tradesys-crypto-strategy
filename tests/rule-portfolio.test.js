import test from "node:test";
import assert from "node:assert/strict";
import { runRulePortfolioBacktest, TF_R } from "../src/backtest/rule-portfolio.js";
import { RULE_STRATEGIES, runRuleStrategyBacktest } from "../src/backtest/rule-strategies.js";

const D = 86_400_000;
const mk = closes => closes.map((c, i) => ({ openTime: i * D, closeTime: (i + 1) * D - 1, open: c, high: c * 1.01, low: c * 0.99, close: c }));
const base = () => [...Array.from({ length: 260 }, (_, i) => 100 + i * 0.2), ...Array(60).fill(152)];

test("chandelier trailing stop protects open profit that the plain 20-day exit gives back", () => {
  const closes = base();
  for (let i = 0; i < 40; i++) closes.push(160 * 1.06 ** i);   // parabolic run
  for (let i = 0; i < 40; i++) closes.push(closes.at(-1) * 0.94); // collapse
  const bars = mk(closes);
  const trf = runRulePortfolioBacktest({ X: bars }, TF_R, { feeBps: 0, slippageBps: 0 });
  const tf = runRuleStrategyBacktest(bars, RULE_STRATEGIES.TF, { feeBps: 0, slippageBps: 0 });
  const peak = Math.max(...closes);
  const exitR = trf.trades[0].exit, exitPlain = tf.trades[0].exit;
  assert.equal(trf.trades[0].reason, "TRAILING_STOP");
  assert.ok(exitR > exitPlain, "trailing exit " + exitR.toFixed(1) + " > plain exit " + exitPlain.toFixed(1));
  assert.ok(1 - exitR / peak < 0.35, "gives back less than 35% from the peak close");
});

test("shared cash: per-position cap, no leverage, alphabetical priority when cash is short", () => {
  const closes = base(); closes.push(160, 161, 162, 163, 164);
  const series = Object.fromEntries(["E", "D", "C", "B", "A", "F"].map(s => [s, mk(closes)]));
  const r = runRulePortfolioBacktest(series, { ...TF_R, maxPositionPct: 20 }, { feeBps: 0, slippageBps: 0, riskPct: 50 });
  const entryDay = Math.min(...r.trades.map(t => t.entryTime));
  const sameDay = r.trades.filter(t => t.entryTime === entryDay);
  // 20% cap -> at most 5 positions fit in 100% cash; F (last alphabetically) is skipped.
  assert.deepEqual(sameDay.map(t => t.symbol).sort(), ["A", "B", "C", "D", "E"]);
  for (const t of sameDay) assert.ok(t.notional <= t.equityAtEntry * 0.2 + 1e-6);
  assert.ok(r.equityCurve.every(p => p.equity > 0));
});

test("portfolio decisions are causal: altering future bars does not change the past equity curve", () => {
  const closes = base(); for (let i = 0; i < 60; i++) closes.push(160 + 10 * Math.sin(i / 4) + i);
  const bars = mk(closes);
  const cut = 350;
  const altered = bars.map((b, i) => i <= cut ? b : { ...b, open: b.open * 3, high: b.high * 3, low: b.low * 3, close: b.close * 3 });
  // Full-period runs on both datasets: everything marked up to the cut must be identical,
  // while the altered future must actually change later results (non-vacuous).
  const a = runRulePortfolioBacktest({ X: bars }, TF_R).equityCurve;
  const b = runRulePortfolioBacktest({ X: altered }, TF_R).equityCurve;
  const upTo = curve => curve.filter(p => p.time <= cut * D);
  assert.ok(upTo(a).length > 300);
  assert.deepEqual(upTo(a), upTo(b));
  assert.notDeepEqual(a, b);
});
