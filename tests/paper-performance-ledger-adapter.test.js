import test from "node:test";
import assert from "node:assert/strict";
import { buildPaperPerformanceReportFromLedger } from "../src/paper/paper-performance-ledger-adapter.js";

const event = (sequence, type, timestamp, payload) => ({
  sequence, eventId: "event_id_" + String(sequence).padStart(4, "0"),
  type, timestamp, payload, previousHash: "0".repeat(64), hash: "a".repeat(64)
});

test("builds report from durable fills and position marks", () => {
  const ledgerSnapshot = {
    status: "COMPLETE", eventCount: 3, lastSequence: 3, lastHash: "b".repeat(64),
    events: [
      event(1, "ORDER_FILLED", 1_800_000_000_000, {
        order: { side: "BUY", symbol: "BTCUSDT", fee: 1, realizedPnl: 0 }
      }),
      event(2, "ORDER_FILLED", 1_800_000_100_000, {
        order: { side: "SELL", symbol: "BTCUSDT", fee: 1, realizedPnl: 20 }
      }),
      event(3, "POSITION_MARKED", 1_800_000_200_000, { equity: 10_020, cash: 10_020, marketValue: 0 })
    ]
  };
  const report = buildPaperPerformanceReportFromLedger({ ledgerSnapshot, initialEquity: 10_000 });
  assert.equal(report.closedTradeCount, 1);
  assert.equal(report.netRealizedPnl, 20);
  assert.equal(report.totalFees, 2);
  assert.equal(report.equityMarkCount, 1);
  assert.equal(report.source.type, "PERSISTENT_PAPER_LEDGER");
  assert.equal(report.status, "COMPLETE");
});

test("marks report incomplete when no durable equity marks exist", () => {
  const ledgerSnapshot = {
    status: "COMPLETE", eventCount: 0, lastSequence: 0, lastHash: "0".repeat(64), events: []
  };
  const report = buildPaperPerformanceReportFromLedger({ ledgerSnapshot, initialEquity: 10_000 });
  assert.equal(report.status, "INCOMPLETE_EQUITY_HISTORY");
  assert.equal(report.equityMarkCount, 0);
  assert.equal(report.maxDrawdownPct, 0);
});

test("rejects unverified or structurally inconsistent ledger snapshots", () => {
  assert.throws(() => buildPaperPerformanceReportFromLedger({
    ledgerSnapshot: { status: "CORRUPT", eventCount: 0, lastSequence: 0, events: [] },
    initialEquity: 100
  }), /complete/);
  assert.throws(() => buildPaperPerformanceReportFromLedger({
    ledgerSnapshot: {
      status: "COMPLETE", eventCount: 1, lastSequence: 1,
      events: [event(2, "POSITION_MARKED", 1_800_000_000_000, { equity: 100 })]
    }, initialEquity: 100
  }), /invalid event/);
  assert.throws(() => buildPaperPerformanceReportFromLedger({
    ledgerSnapshot: {
      status: "COMPLETE", eventCount: 1, lastSequence: 1,
      events: [event(1, "POSITION_MARKED", 1_800_000_000_000, { equity: null })]
    }, initialEquity: 100
  }), /valid equity/);
});
