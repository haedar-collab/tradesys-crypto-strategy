import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePaperRisk, createPaperRiskMonitor } from "../src/risk/paper-risk-monitor.js";

const snap = (equity, positions = [], timestamp = 1_800_000_000_000) => ({ equity, positions, timestamp });

test("allows a portfolio inside daily loss, drawdown and exposure limits", () => {
  const r = evaluatePaperRisk({ equity: 10_000, peakEquity: 10_000, dayStartEquity: 10_000,
    openPositions: [{ quantity: 2, markPrice: 100 }] });
  assert.equal(r.allowed, true);
  assert.equal(r.exposurePct, 2);
});

test("blocks daily loss at the configured threshold", () => {
  const r = evaluatePaperRisk({ equity: 9_700, peakEquity: 10_000, dayStartEquity: 10_000, openPositions: [] });
  assert.ok(r.reasons.includes("DAILY_LOSS_LIMIT_REACHED"));
});

test("blocks maximum drawdown and excessive exposure", () => {
  const dd = evaluatePaperRisk({ equity: 8_900, peakEquity: 10_000, dayStartEquity: 10_000, openPositions: [] });
  assert.ok(dd.reasons.includes("MAX_DRAWDOWN_LIMIT_REACHED"));
  const exp = evaluatePaperRisk({ equity: 10_000, peakEquity: 10_000, dayStartEquity: 10_000,
    openPositions: [{ quantity: 9, markPrice: 1000 }] });
  assert.ok(exp.reasons.includes("MAX_EXPOSURE_LIMIT_EXCEEDED"));
});

test("fails closed for missing or invalid position marks", () => {
  assert.equal(evaluatePaperRisk({}).allowed, false);
  const r = evaluatePaperRisk({ equity: 10_000, peakEquity: 10_000, dayStartEquity: 10_000,
    openPositions: [{ quantity: 1, markPrice: 0 }] });
  assert.equal(r.status, "WAIT_DATA");
});

test("kill switch latches after a risk breach and blocks entries after recovery", () => {
  const monitor = createPaperRiskMonitor();
  monitor.evaluate(snap(10_000));
  const breached = monitor.evaluate(snap(9_600, [], 1_800_000_000_001));
  assert.equal(breached.halted, true);
  const recovered = monitor.evaluate(snap(9_800, [], 1_800_000_000_001));
  assert.equal(recovered.allowNewEntries, false);
  assert.equal(recovered.halted, true);
});

test("manual kill switch activates and requires explicit reset", () => {
  const monitor = createPaperRiskMonitor();
  assert.equal(monitor.activate().halted, true);
  assert.equal(monitor.evaluate(snap(10_000)).allowNewEntries, false);
  assert.equal(monitor.reset(snap(10_000)).halted, false);
});

test("cannot reset while a hard risk threshold remains breached", () => {
  const monitor = createPaperRiskMonitor();
  monitor.evaluate(snap(10_000));
  monitor.activate("OPERATOR_STOP");
  assert.throws(() => monitor.reset(snap(8_000, [], 1_800_000_000_001)), /risk limits remain breached/);
});

test("daily baseline rolls at UTC date boundary", () => {
  const monitor = createPaperRiskMonitor();
  monitor.evaluate(snap(10_000, [], Date.UTC(2027, 0, 1, 23, 59)));
  const next = monitor.evaluate(snap(9_900, [], Date.UTC(2027, 0, 2, 0, 1)));
  assert.equal(next.dailyLossPct, 0);
  assert.ok(monitor.status().events.some(e => e.type === "RISK_DAY_ROLLOVER"));
});

test("records kill-switch audit events", () => {
  const monitor = createPaperRiskMonitor();
  monitor.evaluate(snap(10_000));
  monitor.evaluate(snap(9_600, [], 1_800_000_000_001));
  assert.ok(monitor.status().events.some(e => e.type === "KILL_SWITCH_ACTIVATED"));
});

test("rejects invalid risk limit configuration", () => {
  assert.throws(() => createPaperRiskMonitor({ dailyLossLimitPct: 0 }), /configuration/);
});


test("resets the daily loss baseline at UTC midnight without resetting peak drawdown", () => {
  const day1 = Date.UTC(2026, 10, 20, 23, 59, 0);
  const day2 = Date.UTC(2026, 10, 21, 0, 1, 0);
  const monitor = createPaperRiskMonitor();
  const first = monitor.evaluate({ equity: 10_000, positions: [], timestamp: day1 });
  assert.equal(first.dayStartEquity, 10_000);
  const nextDay = monitor.evaluate({ equity: 9_900, positions: [], timestamp: day2 });
  assert.equal(nextDay.dayKey, "2026-11-21");
  assert.equal(nextDay.dayStartEquity, 9_900);
  assert.equal(nextDay.peakEquity, 10_000);
  assert.equal(nextDay.dailyLossPct, 0);
  assert.equal(nextDay.drawdownPct, 1);
});
