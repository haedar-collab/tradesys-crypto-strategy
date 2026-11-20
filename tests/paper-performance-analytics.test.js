import test from "node:test";
import assert from "node:assert/strict";
import { buildPaperPerformanceReport } from "../src/paper/paper-performance-analytics.js";

const day = (n) => Date.UTC(2026, 0, n, 12);

function fill(id, side, pnl, fee, timestamp) {
  return { sequence: timestamp, eventId: id, type: "ORDER_FILLED", timestamp,
    payload: { order: { clientOrderId: id, symbol: "BTCUSDT", side,
      realizedPnl: pnl, fee, filledAt: timestamp } } };
}

test("calculates realized trade statistics and UTC period PnL", () => {
  const report = buildPaperPerformanceReport({
    initialEquity: 10_000,
    events: [
      fill("buy_000001", "BUY", 0, 1, day(1)),
      fill("sell_00001", "SELL", 100, 1, day(2)),
      fill("sell_00002", "SELL", -40, 1, day(3))
    ],
    equitySnapshots: [
      { timestamp: day(1), equity: 10_000 },
      { timestamp: day(2), equity: 10_100 },
      { timestamp: day(3), equity: 10_060 }
    ]
  });
  assert.equal(report.closedTradeCount, 2);
  assert.equal(report.winRatePct, 50);
  assert.equal(report.profitFactor, 2.5);
  assert.equal(report.netRealizedPnl, 60);
  assert.equal(report.totalFees, 3);
  assert.equal(report.maxDrawdownPct, 0.39604);
  assert.equal(report.daily.length, 2);
});

test("returns null for undefined ratios when no closed trades or no losses exist", () => {
  const empty = buildPaperPerformanceReport({ initialEquity: 1_000, events: [] });
  assert.equal(empty.winRatePct, null);
  assert.equal(empty.profitFactor, null);
  const noLoss = buildPaperPerformanceReport({
    initialEquity: 1_000, events: [fill("sell_00003", "SELL", 10, 1, day(4))]
  });
  assert.equal(noLoss.profitFactor, null);
});

test("rejects invalid input instead of manufacturing metrics", () => {
  assert.throws(() => buildPaperPerformanceReport({ initialEquity: 0, events: [] }), /initialEquity/);
  assert.throws(() => buildPaperPerformanceReport({ initialEquity: 100, events: [{ type: "ORDER_FILLED", payload: {} }] }), /ORDER_FILLED/);
  assert.throws(() => buildPaperPerformanceReport({
    initialEquity: 100, events: [], equitySnapshots: [{ timestamp: -1, equity: 100 }]
  }), /snapshot/);
});

test("accepts in-memory broker ORDER_FILLED events", () => {
  const report = buildPaperPerformanceReport({
    initialEquity: 5_000,
    events: [{ type: "ORDER_FILLED", at: day(5), clientOrderId: "sell_00004",
      side: "SELL", symbol: "ETHUSDT", realizedPnl: 25, fee: 2, filledAt: day(5) }]
  });
  assert.equal(report.netRealizedPnl, 25);
  assert.equal(report.closedTradeCount, 1);
});
