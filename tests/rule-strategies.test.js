import test from "node:test";
import assert from "node:assert/strict";
import { RULE_STRATEGIES, prepareRuleIndicators, entrySignal, runRuleStrategyBacktest } from "../src/backtest/rule-strategies.js";

const D = 86_400_000;
const bars = closes => closes.map((c, i) => ({ openTime: i * D, closeTime: (i + 1) * D - 1,
  open: c.o ?? c, high: c.h ?? c * 1.01, low: c.l ?? c * 0.99, close: c.c ?? c }));
const rising = n => Array.from({ length: n }, (_, i) => 100 + i * 0.2);

test("TF enters on a 55-day breakout above SMA200 at the next open and exits on a 20-day low", () => {
  const closes = [...rising(260)];
  for (let i = 0; i < 60; i++) closes.push(152);               // flat base
  closes.push(160);                                             // breakout close (index 320)
  for (let i = 0; i < 10; i++) closes.push(165 + i);            // trend continues
  for (let i = 0; i < 25; i++) closes.push(140);                // breakdown below 20-day low
  const b = bars(closes);
  const result = runRuleStrategyBacktest(b, RULE_STRATEGIES.TF, { feeBps: 0, slippageBps: 0 });
  const trade = result.trades.find(t => t.entryTime === 321 * D);
  assert.ok(trade, JSON.stringify(result.trades.map(t => t.entryTime / D)));
  assert.equal(trade.entry, b[321].open, "fills at the next daily open");
  assert.ok(["DONCHIAN_EXIT", "STOP"].includes(trade.reason));
});

test("MR buys an oversold dip in an uptrend and exits when close regains SMA5", () => {
  const closes = rising(260);
  closes.push(148, 140, 136);              // sharp dip -> RSI(2) < 10, still above SMA200 (~126)
  closes.push(150, 152, 153, 154, 155);
  const b = bars(closes);
  const result = runRuleStrategyBacktest(b, RULE_STRATEGIES.MR, { feeBps: 0, slippageBps: 0 });
  assert.ok(result.trades.length >= 1);
  const t = result.trades[0];
  assert.equal(t.reason, "CLOSE_ABOVE_SMA5");
  assert.ok(t.netPnl > 0);
});

test("signals are causal: bar i's entry signal does not change when future bars change", () => {
  const closes = rising(300).map((c, i) => c + 8 * Math.sin(i / 3));
  const full = bars(closes);
  for (const strategy of Object.values(RULE_STRATEGIES)) {
    const ind = prepareRuleIndicators(full, strategy);
    for (const cut of [210, 240, 270]) {
      const prefix = full.slice(0, cut + 1);
      const altered = [...prefix, ...bars(closes.slice(cut + 1).map(c => c * 3)).map((x, k) => ({ ...x, openTime: (cut + 1 + k) * D, closeTime: (cut + 2 + k) * D - 1 }))];
      const indAlt = prepareRuleIndicators(altered, strategy);
      for (let i = 200; i <= cut; i++) assert.equal(entrySignal(strategy, ind, i), entrySignal(strategy, indAlt, i), strategy.id + " i=" + i);
    }
  }
});

test("a gap below the stop fills at the open, not at the stop", () => {
  const closes = rising(260);
  closes.push(148, 140, 136);
  const b = bars(closes);
  b.push({ openTime: b.length * D, closeTime: (b.length + 1) * D - 1, open: 137, high: 138, low: 136.5, close: 137 }); // entry bar
  b.push({ openTime: b.length * D, closeTime: (b.length + 1) * D - 1, open: 90, high: 95, low: 85, close: 92 });     // gap down
  const result = runRuleStrategyBacktest(b, RULE_STRATEGIES.MR, { feeBps: 0, slippageBps: 0 });
  const t = result.trades.find(x => x.reason === "STOP");
  assert.ok(t);
  assert.equal(t.exit, 90);
});

test("trades only open inside [from, to) and positions are closed when the range ends", () => {
  const closes = rising(400).map((c, i) => c + 10 * Math.sin(i / 4));
  const b = bars(closes);
  const from = 250 * D, to = 330 * D;
  for (const strategy of Object.values(RULE_STRATEGIES)) {
    const r = runRuleStrategyBacktest(b, strategy, { from, to });
    assert.ok(r.trades.every(t => t.entryTime >= from && t.entryTime < to && t.exitTime <= to), strategy.id);
  }
  assert.throws(() => runRuleStrategyBacktest(b, { id: "X" }), /unknown rule strategy/);
});
