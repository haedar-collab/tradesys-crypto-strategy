import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistentPaperSession } from "../src/paper/persistent-paper-session.js";
import { buildPaperPerformanceReportFromLedger } from "../src/paper/paper-performance-ledger-adapter.js";

const ACCEPT = { decision: "ACCEPT", eligibleForPaperTrading: true };
function clockFixture() {
  let time = Date.UTC(2026, 0, 1, 0, 0, 0);
  return { now: () => time, advance: ms => { time += ms; } };
}
const quote = (timestamp, bid, ask) => ({ timestamp, bid, ask });

test("extended paper simulation survives repeated restart and produces ledger-backed analytics", async () => {
  const clock = clockFixture();
  const dir = await mkdtemp(join(tmpdir(), "tradesys-extended-paper-"));
  const filePath = join(dir, "simulation.jsonl");
  const initialCash = 10_000;
  let session;
  let totalCycles = 0;
  try {
    session = await createPersistentPaperSession({ filePath, initialCash, now: clock.now });
    for (let cycle = 0; cycle < 12; cycle++) {
      const id = "sim_order_" + String(cycle).padStart(4, "0");
      const buyQuote = quote(clock.now(), 100, 101);
      const buy = await session.submitMarketOrder({
        clientOrderId: id + "_buy", symbol: "BTCUSDT", side: "BUY",
        quantity: 0.1, quote: buyQuote, strategyAcceptance: ACCEPT
      });
      assert.equal(buy.status, "FILLED");
      const markQuote = quote(clock.now(), 102, 103);
      const mark = await session.markToMarket({ BTCUSDT: markQuote });
      assert.ok(mark.equity > 0);
      const sell = await session.submitMarketOrder({
        clientOrderId: id + "_sell", symbol: "BTCUSDT", side: "SELL",
        quantity: 0.1, quote: markQuote, strategyAcceptance: ACCEPT
      });
      assert.equal(sell.status, "FILLED");
      totalCycles++;
      clock.advance(6 * 60 * 60 * 1000);

      if ((cycle + 1) % 4 === 0 && cycle !== 11) {
        await session.close();
        session = await createPersistentPaperSession({ filePath, initialCash, now: clock.now });
        assert.equal(session.recoveryAudit().status, "PASS");
        const restored = await session.snapshot();
        assert.equal(restored.mode, "PAPER_ONLY");
        assert.equal(restored.broker.positions.length, 0);
      }
    }

    const finalSnapshot = await session.snapshot();
    const audit = session.recoveryAudit();
    const report = buildPaperPerformanceReportFromLedger({
      ledgerSnapshot: finalSnapshot.ledger,
      initialEquity: initialCash
    });
    assert.equal(audit.status, "PASS");
    assert.equal(finalSnapshot.mode, "PAPER_ONLY");
    assert.equal(finalSnapshot.broker.positions.length, 0);
    assert.equal(finalSnapshot.ledger.events.filter(e => e.type === "ORDER_FILLED").length, totalCycles * 2);
    assert.equal(report.status, "COMPLETE");
    assert.equal(report.closedTradeCount, totalCycles);
    assert.equal(report.equityMarkCount, totalCycles);
    assert.ok(report.totalFees > 0);
    assert.ok(report.netRealizedPnl > 0);
    assert.ok(Number.isFinite(report.maxDrawdownPct));
    await session.close();
  } finally {
    if (session) await session.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

test("extended simulation refuses a new session when the ledger is concurrently locked", async () => {
  const clock = clockFixture();
  const dir = await mkdtemp(join(tmpdir(), "tradesys-extended-lock-"));
  const filePath = join(dir, "locked.jsonl");
  let session;
  try {
    session = await createPersistentPaperSession({ filePath, now: clock.now });
    await assert.rejects(
      createPersistentPaperSession({ filePath, now: clock.now }),
      /locked by another process/
    );
    assert.equal(session.recoveryAudit().status, "PASS");
  } finally {
    if (session) await session.close();
    await rm(dir, { recursive: true, force: true });
  }
});
