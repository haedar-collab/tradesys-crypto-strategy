import test from "node:test";
import assert from "node:assert/strict";
import { buildPaperDashboardViewModel } from "../src/paper/paper-dashboard-view-model.js";

const ledger = { status: "COMPLETE", events: [{ sequence: 1 }], eventCount: 1, lastSequence: 1 };
const report = {
  status: "COMPLETE", netRealizedPnl: 125, netRealizedReturnPct: 1.25,
  winRatePct: 60, profitFactor: 1.8, maxDrawdownPct: 4,
  closedTradeCount: 5, totalFees: 3, equityMarkCount: 12
};

test("dashboard is explicitly read-only and paper-only", () => {
  const vm = buildPaperDashboardViewModel();
  assert.equal(vm.mode, "PAPER_ONLY");
  assert.deepEqual(vm.permissions, {
    readOnly: true, maySubmitOrders: false, mayMutateLedger: false, mayResetRisk: false
  });
});

test("healthy feed exposes quote and age", () => {
  const vm = buildPaperDashboardViewModel({
    now: 10_000, maxQuoteAgeMs: 1_000,
    feedStatus: { state: "CONNECTED" },
    quote: { symbol: "BTCUSDT", timestamp: 9_500, bid: 99, ask: 101, source: "BINANCE_SPOT_WS" }
  });
  assert.equal(vm.market.state, "HEALTHY");
  assert.equal(vm.market.quoteAgeMs, 500);
  assert.equal(vm.market.spread, 2);
});

test("disconnected feed hides otherwise valid quote", () => {
  const vm = buildPaperDashboardViewModel({
    now: 10_000, feedStatus: { state: "DISCONNECTED" },
    quote: { timestamp: 9_900, bid: 99, ask: 100 }
  });
  assert.equal(vm.market.state, "DISCONNECTED");
  assert.equal(vm.market.bid, null);
});

test("stale and future quotes fail closed", () => {
  const stale = buildPaperDashboardViewModel({
    now: 10_000, maxQuoteAgeMs: 500, feedStatus: { connected: true },
    quote: { timestamp: 9_000, bid: 99, ask: 100 }
  });
  const future = buildPaperDashboardViewModel({
    now: 10_000, feedStatus: { connected: true },
    quote: { timestamp: 10_001, bid: 99, ask: 100 }
  });
  assert.equal(stale.market.state, "STALE");
  assert.equal(stale.market.bid, null);
  assert.equal(future.market.state, "WAIT_QUOTE");
});

test("invalid quote values are not exposed", () => {
  const vm = buildPaperDashboardViewModel({
    now: 10_000, feedStatus: { connected: true },
    quote: { timestamp: 9_999, bid: 102, ask: 101 }
  });
  assert.equal(vm.market.state, "WAIT_QUOTE");
  assert.equal(vm.market.ask, null);
});

test("strategy acceptance is projected without triggering execution", () => {
  const vm = buildPaperDashboardViewModel({
    signal: { symbol: "BTCUSDT", side: "BUY", clientOrderId: "sig-1" },
    acceptance: { decision: "ACCEPT" }
  });
  assert.equal(vm.strategy.status, "ELIGIBLE_FOR_PAPER");
  assert.equal(vm.strategy.signalId, "sig-1");
  assert.equal(vm.permissions.maySubmitOrders, false);
});

test("rejected and missing acceptance remain non-eligible", () => {
  assert.equal(buildPaperDashboardViewModel({ acceptance: { decision: "REJECT" } }).strategy.status, "NOT_ELIGIBLE");
  assert.equal(buildPaperDashboardViewModel().strategy.status, "NOT_EVALUATED");
});

test("performance is withheld for incomplete ledger", () => {
  const vm = buildPaperDashboardViewModel({
    ledgerSnapshot: { ...ledger, status: "RECOVERY_REQUIRED" },
    performanceReport: report
  });
  assert.equal(vm.performance.status, "UNAVAILABLE");
  assert.equal(vm.performance.netRealizedPnl, null);
});

test("performance is withheld when report is incomplete", () => {
  const vm = buildPaperDashboardViewModel({
    ledgerSnapshot: ledger, performanceReport: { ...report, status: "INCOMPLETE_EQUITY_HISTORY" }
  });
  assert.equal(vm.performance.status, "INCOMPLETE_ANALYTICS");
  assert.equal(vm.performance.maxDrawdownPct, null);
});

test("complete ledger and analytics expose recorded metrics", () => {
  const vm = buildPaperDashboardViewModel({ ledgerSnapshot: ledger, performanceReport: report });
  assert.equal(vm.performance.status, "COMPLETE");
  assert.equal(vm.performance.netRealizedPnl, 125);
  assert.equal(vm.performance.maxDrawdownPct, 4);
});

test("latched kill switch takes precedence over nominal allowed status", () => {
  const vm = buildPaperDashboardViewModel({
    riskStatus: { status: "ALLOWED", allowed: true, halted: true, haltReasons: ["MANUAL_KILL_SWITCH"] }
  });
  assert.equal(vm.risk.state, "KILL_SWITCH_LATCHED");
  assert.deepEqual(vm.risk.reasons, ["MANUAL_KILL_SWITCH"]);
});

test("unmarked positions remain visible and flagged, never estimated", () => {
  const vm = buildPaperDashboardViewModel({
    positions: [
      { symbol: "BTCUSDT", quantity: 0.1, markPrice: 50_000 },
      { symbol: "ETHUSDT", quantity: 1 }
    ]
  });
  assert.equal(vm.portfolio.positionCount, 2);
  assert.equal(vm.portfolio.positions[1].marketValue, null);
  assert.equal(vm.portfolio.positions[1].markStatus, "UNMARKED");
  assert.equal(vm.dataQuality.hasUnmarkedPositions, true);
});

test("inputs are not mutated", () => {
  const risk = { halted: true, haltReasons: ["risk"] };
  const before = structuredClone(risk);
  buildPaperDashboardViewModel({ riskStatus: risk });
  assert.deepEqual(risk, before);
});

test("invalid timestamps, limits, and position snapshots are rejected", () => {
  assert.throws(() => buildPaperDashboardViewModel({ now: -1 }), /timestamp/);
  assert.throws(() => buildPaperDashboardViewModel({ maxQuoteAgeMs: -1 }), /maxQuoteAgeMs/);
  assert.throws(() => buildPaperDashboardViewModel({ positions: [{}] }), /position snapshot/);
});
