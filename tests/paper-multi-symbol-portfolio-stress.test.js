import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistentPaperSession } from "../src/paper/persistent-paper-session.js";
import { buildPaperPerformanceReportFromLedger } from "../src/paper/paper-performance-ledger-adapter.js";

const ACCEPT = { decision: "ACCEPT", eligibleForPaperTrading: true };
function clockFixture() {
  let time = Date.UTC(2026, 2, 1, 0, 0, 0);
  return { now: () => time, advance: ms => { time += ms; } };
}
const quote = (timestamp, bid, ask) => ({ timestamp, bid, ask });

test("multi-symbol portfolio marks, aggregate exposure gate and recovery remain consistent", async () => {
  const clock = clockFixture();
  const dir = await mkdtemp(join(tmpdir(), "tradesys-multi-symbol-"));
  const filePath = join(dir, "portfolio.jsonl");
  const config = { filePath, initialCash: 10_000, maxExposurePct: 80, now: clock.now };
  let session;
  try {
    session = await createPersistentPaperSession(config);
    const entries = [
      { symbol: "BTCUSDT", quantity: 2, bid: 1_000, ask: 1_001 },
      { symbol: "ETHUSDT", quantity: 4, bid: 500, ask: 501 },
      { symbol: "SOLUSDT", quantity: 10, bid: 100, ask: 101 }
    ];
    for (const item of entries) {
      const order = await session.submitMarketOrder({
        clientOrderId: "multi_buy_" + item.symbol.slice(0, 3),
        symbol: item.symbol, side: "BUY", quantity: item.quantity,
        quote: quote(clock.now(), item.bid, item.ask), strategyAcceptance: ACCEPT
      });
      assert.equal(order.status, "FILLED");
    }

    const markQuotes = Object.fromEntries(entries.map(item => [
      item.symbol, quote(clock.now(), item.bid, item.ask)
    ]));
    const marked = await session.markToMarket(markQuotes);
    assert.equal(marked.marks.length, 3);
    assert.deepEqual(marked.marks.map(x => x.symbol).sort(), ["BTCUSDT", "ETHUSDT", "SOLUSDT"]);
    assert.ok(marked.equity > 0);
    assert.ok(marked.risk.exposurePct > 0 && marked.risk.exposurePct < 80);

    await session.close();
    session = await createPersistentPaperSession(config);
    assert.equal(session.recoveryAudit().status, "PASS");
    let restored = await session.snapshot();
    assert.equal(restored.broker.positions.length, 3);
    assert.deepEqual(restored.broker.positions.map(x => x.symbol).sort(), ["BTCUSDT", "ETHUSDT", "SOLUSDT"]);

    // A mark older than the configured risk-mark age must not authorize a new entry.
    clock.advance(60_001);
    await assert.rejects(session.submitMarketOrder({
      clientOrderId: "multi_stale_entry", symbol: "BTCUSDT", side: "BUY", quantity: 0.01,
      quote: quote(clock.now(), 1_000, 1_001), strategyAcceptance: ACCEPT
    }), /RISK_DATA_UNAVAILABLE/);

    const freshQuotes = Object.fromEntries(entries.map(item => [
      item.symbol, quote(clock.now(), item.bid, item.ask)
    ]));
    const fresh = await session.markToMarket(freshQuotes);
    assert.equal(fresh.marks.length, 3);

    // The fourth leg would push aggregate portfolio exposure above 80%.
    await assert.rejects(session.submitMarketOrder({
      clientOrderId: "multi_over_exposure", symbol: "BTCUSDT", side: "BUY", quantity: 3,
      quote: quote(clock.now(), 1_000, 1_001), strategyAcceptance: ACCEPT
    }), /MAX_EXPOSURE_LIMIT_EXCEEDED/);
    assert.equal(session.riskStatus().halted, true);

    // The kill switch blocks entries, not exits; flatten all three symbols.
    for (const item of entries) {
      const sell = await session.submitMarketOrder({
        clientOrderId: "multi_sell_" + item.symbol.slice(0, 3),
        symbol: item.symbol, side: "SELL", quantity: item.quantity,
        quote: quote(clock.now(), item.bid - 1, item.bid), strategyAcceptance: ACCEPT
      });
      assert.equal(sell.status, "FILLED");
    }

    restored = await session.snapshot();
    assert.equal(restored.broker.positions.length, 0);
    assert.equal(restored.risk.halted, true);
    assert.equal(session.recoveryAudit().status, "PASS");
    const report = buildPaperPerformanceReportFromLedger({
      ledgerSnapshot: restored.ledger, initialEquity: 10_000
    });
    assert.equal(report.status, "COMPLETE");
    assert.equal(report.closedTradeCount, 3);
    assert.ok(report.totalFees > 0);
    assert.equal(restored.ledger.events.filter(e => e.type === "ORDER_FILLED").length, 6);
  } finally {
    if (session) await session.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});
