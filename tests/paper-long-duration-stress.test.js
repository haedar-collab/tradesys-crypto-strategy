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

test("long-duration paper simulation preserves ledger, broker state and analytics across repeated restarts", async () => {
  const clock = clockFixture();
  const dir = await mkdtemp(join(tmpdir(), "tradesys-long-duration-"));
  const filePath = join(dir, "stress.jsonl");
  const initialCash = 10_000;
  const cycles = 64;
  const restartEvery = 8;
  let session;
  try {
    session = await createPersistentPaperSession({ filePath, initialCash, now: clock.now });
    for (let cycle = 0; cycle < cycles; cycle++) {
      const id = "stress_" + String(cycle).padStart(4, "0");
      const buyQuote = quote(clock.now(), 100, 101);
      const buy = await session.submitMarketOrder({
        clientOrderId: id + "_buy", symbol: "BTCUSDT", side: "BUY",
        quantity: 0.01, quote: buyQuote, strategyAcceptance: ACCEPT
      });
      assert.equal(buy.status, "FILLED", "BUY cycle " + cycle);

      const markQuote = quote(clock.now(), 102, 103);
      const mark = await session.markToMarket({ BTCUSDT: markQuote });
      assert.ok(Number.isFinite(mark.equity) && mark.equity > 0);

      const sell = await session.submitMarketOrder({
        clientOrderId: id + "_sell", symbol: "BTCUSDT", side: "SELL",
        quantity: 0.01, quote: markQuote, strategyAcceptance: ACCEPT
      });
      assert.equal(sell.status, "FILLED", "SELL cycle " + cycle);
      clock.advance(6 * 60 * 60 * 1000);

      if ((cycle + 1) % restartEvery === 0 && cycle + 1 < cycles) {
        await session.close();
        session = await createPersistentPaperSession({ filePath, initialCash, now: clock.now });
        assert.equal(session.recoveryAudit().status, "PASS");
        const restored = await session.snapshot();
        assert.equal(restored.mode, "PAPER_ONLY");
        assert.equal(restored.broker.positions.length, 0);
      }
    }

    const snapshot = await session.snapshot();
    const report = buildPaperPerformanceReportFromLedger({
      ledgerSnapshot: snapshot.ledger, initialEquity: initialCash
    });
    assert.equal(session.recoveryAudit().status, "PASS");
    assert.equal(snapshot.ledger.events.filter(e => e.type === "ORDER_FILLED").length, cycles * 2);
    assert.equal(snapshot.ledger.events.filter(e => e.type === "POSITION_MARKED").length, cycles);
    assert.equal(snapshot.broker.positions.length, 0);
    assert.equal(report.status, "COMPLETE");
    assert.equal(report.closedTradeCount, cycles);
    assert.equal(report.equityMarkCount, cycles);
    assert.ok(report.totalFees > 0);
    assert.ok(Number.isFinite(report.netRealizedPnl));
    assert.ok(Number.isFinite(report.maxDrawdownPct));
    assert.equal(snapshot.mode, "PAPER_ONLY");
  } finally {
    if (session) await session.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

test("latched kill switch blocks fresh entries but does not prevent an existing paper position from exiting", async () => {
  const clock = clockFixture();
  const dir = await mkdtemp(join(tmpdir(), "tradesys-risk-exit-stress-"));
  const filePath = join(dir, "risk-exit.jsonl");
  let session;
  try {
    session = await createPersistentPaperSession({ filePath, initialCash: 10_000, now: clock.now });
    const entryQuote = quote(clock.now(), 100, 101);
    const buy = await session.submitMarketOrder({
      clientOrderId: "risk_exit_existing_buy", symbol: "BTCUSDT", side: "BUY",
      quantity: 0.01, quote: entryQuote, strategyAcceptance: ACCEPT
    });
    assert.equal(buy.status, "FILLED");
    // Establish a fresh durable portfolio mark so the attempted BUY is rejected
    // for the latched kill switch rather than for missing risk data.
    await session.markToMarket({ BTCUSDT: quote(clock.now(), 100, 101) });

    await session.activateKillSwitch("STRESS_TEST_OPERATOR_STOP");
    await assert.rejects(session.submitMarketOrder({
      clientOrderId: "risk_exit_new_buy", symbol: "BTCUSDT", side: "BUY",
      quantity: 0.01, quote: entryQuote, strategyAcceptance: ACCEPT
    }), /KILL_SWITCH_LATCHED/);

    const exitQuote = quote(clock.now(), 99, 100);
    const sell = await session.submitMarketOrder({
      clientOrderId: "risk_exit_existing_sell", symbol: "BTCUSDT", side: "SELL",
      quantity: 0.01, quote: exitQuote, strategyAcceptance: ACCEPT
    });
    assert.equal(sell.status, "FILLED");
    const snapshot = await session.snapshot();
    assert.equal(snapshot.risk.halted, true);
    assert.equal(snapshot.broker.positions.length, 0);
    assert.equal(snapshot.ledger.events.filter(e => e.type === "ORDER_FILLED").length, 2);
    assert.equal(session.recoveryAudit().status, "PASS");
  } finally {
    if (session) await session.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});
