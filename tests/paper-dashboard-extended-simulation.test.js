import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistentPaperSession } from "../src/paper/persistent-paper-session.js";
import { buildPaperPerformanceReportFromLedger } from "../src/paper/paper-performance-ledger-adapter.js";
import { buildPaperDashboardViewModel } from "../src/paper/paper-dashboard-view-model.js";

const ACCEPT = { decision: "ACCEPT", eligibleForPaperTrading: true };
function clockFixture() {
  let time = Date.UTC(2026, 10, 21, 0, 0, 0);
  return { now: () => time, advance: ms => { time += ms; } };
}
const quote = (timestamp, bid, ask, symbol) => ({
  timestamp, bid, ask, symbol, source: "BINANCE_SPOT_WS_BOOK_TICKER"
});

test("4I.25 multi-symbol dashboard simulation survives feed loss, recovery, kill switch and restart", async () => {
  const clock = clockFixture();
  const dir = await mkdtemp(join(tmpdir(), "tradesys-dashboard-stress-"));
  const filePath = join(dir, "dashboard-stress.jsonl");
  const config = { filePath, initialCash: 10_000, maxExposurePct: 80, now: clock.now };
  const symbols = [
    { symbol: "BTCUSDT", quantity: 0.01, bid: 50_000, ask: 50_010 },
    { symbol: "ETHUSDT", quantity: 0.1, bid: 3_000, ask: 3_001 },
    { symbol: "SOLUSDT", quantity: 1, bid: 140, ask: 141 }
  ];
  let session;
  try {
    session = await createPersistentPaperSession(config);

    for (const item of symbols) {
      const entry = await session.submitMarketOrder({
        clientOrderId: "stage425_buy_" + item.symbol,
        symbol: item.symbol, side: "BUY", quantity: item.quantity,
        quote: quote(clock.now(), item.bid, item.ask, item.symbol),
        strategyAcceptance: ACCEPT
      });
      assert.equal(entry.status, "FILLED");
      await session.markToMarket(Object.fromEntries(
        symbols.filter(x => symbols.indexOf(x) <= symbols.indexOf(item)).map(x => [x.symbol,
          quote(clock.now(), x.bid, x.ask, x.symbol)]));
    }

    let snapshot = await session.snapshot();
    assert.equal(snapshot.broker.positions.length, 3);
    const initialMark = snapshot.ledger.events.filter(e => e.type === "POSITION_MARKED").at(-1);
    const positions = initialMark.payload.marks.map(x => ({
      symbol: x.symbol, quantity: x.quantity, markPrice: x.markPrice
    }));
    const connected = buildPaperDashboardViewModel({
      now: clock.now(), feedStatus: { state: "CONNECTED" },
      quote: quote(clock.now(), 50_000, 50_010, "BTCUSDT"),
      signal: { symbol: "BTCUSDT", side: "BUY", id: "stage425_signal" },
      acceptance: { decision: "ACCEPT" },
      ledgerSnapshot: snapshot.ledger,
      performanceReport: buildPaperPerformanceReportFromLedger({
        ledgerSnapshot: snapshot.ledger, initialEquity: 10_000
      }),
      riskStatus: snapshot.risk, positions
    });
    assert.equal(connected.market.state, "HEALTHY");
    assert.equal(connected.portfolio.positionCount, 3);
    assert.equal(connected.strategy.status, "ELIGIBLE_FOR_PAPER");
    assert.equal(connected.performance.status, "COMPLETE");
    assert.equal(connected.permissions.maySubmitOrders, false);

    const durableMarkCount = snapshot.ledger.events.filter(e => e.type === "POSITION_MARKED").length;
    clock.advance(10_000);
    const disconnected = buildPaperDashboardViewModel({
      now: clock.now(), feedStatus: { state: "DISCONNECTED" },
      quote: quote(clock.now() - 10_000, 50_000, 50_010, "BTCUSDT"),
      ledgerSnapshot: snapshot.ledger, performanceReport: buildPaperPerformanceReportFromLedger({
        ledgerSnapshot: snapshot.ledger, initialEquity: 10_000
      }), riskStatus: snapshot.risk, positions
    });
    assert.equal(disconnected.market.state, "DISCONNECTED");
    assert.equal(disconnected.market.bid, null);
    assert.equal(disconnected.portfolio.positionCount, 3);
    assert.equal(disconnected.performance.status, "COMPLETE");
    assert.equal(snapshot.ledger.events.filter(e => e.type === "POSITION_MARKED").length, durableMarkCount,
      "feed loss must not fabricate a durable equity mark");

    // Reconnect with a fresh quote set, then persist a real portfolio mark.
    clock.advance(1);
    const recoveredQuotes = Object.fromEntries(symbols.map(x => [
      x.symbol, quote(clock.now(), x.bid + 1, x.ask + 1, x.symbol)
    ]));
    await session.markToMarket(recoveredQuotes);
    snapshot = await session.snapshot();
    assert.equal(snapshot.ledger.events.filter(e => e.type === "POSITION_MARKED").length, durableMarkCount + 1);
    const recoveredPositions = snapshot.ledger.events.filter(e => e.type === "POSITION_MARKED").at(-1)
      .payload.marks.map(x => ({ symbol: x.symbol, quantity: x.quantity, markPrice: x.markPrice }));
    const recoveredVm = buildPaperDashboardViewModel({
      now: clock.now(), feedStatus: { state: "CONNECTED" },
      quote: recoveredQuotes.BTCUSDT,
      ledgerSnapshot: snapshot.ledger,
      performanceReport: buildPaperPerformanceReportFromLedger({
        ledgerSnapshot: snapshot.ledger, initialEquity: 10_000
      }),
      riskStatus: snapshot.risk, positions: recoveredPositions
    });
    assert.equal(recoveredVm.market.state, "HEALTHY");
    assert.equal(recoveredVm.performance.status, "COMPLETE");
    assert.equal(recoveredVm.portfolio.unmarkedPositionCount, 0);

    await session.activateKillSwitch("STAGE_4I25_STRESS_STOP");
    snapshot = await session.snapshot();
    const haltedVm = buildPaperDashboardViewModel({
      now: clock.now(), feedStatus: { state: "CONNECTED" },
      quote: recoveredQuotes.BTCUSDT, ledgerSnapshot: snapshot.ledger,
      riskStatus: snapshot.risk, positions: recoveredPositions
    });
    assert.equal(haltedVm.risk.state, "KILL_SWITCH_LATCHED");
    assert.equal(haltedVm.risk.halted, true);

    // Exits remain available under the latched kill switch.
    for (const item of symbols) {
      const exit = await session.submitMarketOrder({
        clientOrderId: "stage425_sell_" + item.symbol,
        symbol: item.symbol, side: "SELL", quantity: item.quantity,
        quote: quote(clock.now(), item.bid, item.ask, item.symbol),
        strategyAcceptance: ACCEPT
      });
      assert.equal(exit.status, "FILLED");
    }
    await session.close();
    session = null;

    // Recovery must preserve the risk latch and empty portfolio.
    session = await createPersistentPaperSession(config);
    assert.equal(session.recoveryAudit().status, "PASS");
    snapshot = await session.snapshot();
    assert.equal(snapshot.mode, "PAPER_ONLY");
    assert.equal(snapshot.broker.positions.length, 0);
    assert.equal(snapshot.risk.halted, true);
    const finalReport = buildPaperPerformanceReportFromLedger({
      ledgerSnapshot: snapshot.ledger, initialEquity: 10_000
    });
    assert.equal(finalReport.status, "COMPLETE");
    assert.equal(finalReport.closedTradeCount, 3);
    assert.equal(snapshot.ledger.events.filter(e => e.type === "ORDER_FILLED").length, 6);
    const finalVm = buildPaperDashboardViewModel({
      now: clock.now(), feedStatus: { state: "DISCONNECTED" },
      ledgerSnapshot: snapshot.ledger, performanceReport: finalReport,
      riskStatus: snapshot.risk, positions: []
    });
    assert.equal(finalVm.risk.state, "KILL_SWITCH_LATCHED");
    assert.equal(finalVm.performance.status, "COMPLETE");
    assert.equal(finalVm.portfolio.positionCount, 0);
    assert.equal(finalVm.permissions.mayResetRisk, false);
  } finally {
    if (session) await session.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});
