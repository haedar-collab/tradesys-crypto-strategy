import test from "node:test";
import assert from "node:assert/strict";
import { runCostSensitivity } from "../src/backtest/cost-sensitivity.js";
import { runEventBacktest } from "../src/backtest/event-driven.js";

const plan = { entry: 100, stop: 95, tp1: 105, tp2: 110, tp3: 115 };
const bars = rows => rows.map((r, i) => ({ t: i * 60_000, o: r[0], h: r[1], l: r[2], c: r[3] }));
const input = {
  bars: bars([[100,101,99,100],[100,104,99.9,103],[100,104,94,96]]),
  signals: [{ index: 0, plan: { ...plan } }]
};

test("runs a complete fee/slippage scenario matrix without mutating baseline input", () => {
  const baseline = structuredClone(input);
  const result = runCostSensitivity(runEventBacktest, input, {
    feeBps: [0, 10],
    slippageBps: [0, 5, 20]
  });
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.scenarioCount, 6);
  assert.deepEqual(result.results.map(x => [x.feeBps, x.slippageBps]), [
    [0,0],[0,5],[0,20],[10,0],[10,5],[10,20]
  ]);
  assert.deepEqual(input, baseline);
});

test("higher adverse slippage does not improve the same closed-trade outcome", () => {
  const result = runCostSensitivity(runEventBacktest, input, {
    feeBps: [10],
    slippageBps: [0, 5, 20, 50]
  });
  const returns = result.results.map(x => x.netReturnPct);
  for (let i = 1; i < returns.length; i++) assert.ok(returns[i] <= returns[i - 1]);
});

test("rejects invalid runner, input, and scenario values", () => {
  assert.throws(() => runCostSensitivity(null, input), TypeError);
  assert.throws(() => runCostSensitivity(runEventBacktest, null), TypeError);
  assert.throws(() => runCostSensitivity(runEventBacktest, input, { feeBps: [] }), RangeError);
  assert.throws(() => runCostSensitivity(runEventBacktest, input, { slippageBps: [0, -1] }), RangeError);
});

test("rejects an invalid backtest result rather than hiding runner failures", () => {
  assert.throws(() => runCostSensitivity(() => ({ status: "BROKEN" }), input), TypeError);
});
