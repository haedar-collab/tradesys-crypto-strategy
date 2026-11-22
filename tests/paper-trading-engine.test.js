import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistentPaperSession } from "../src/paper/persistent-paper-session.js";
import { createBinanceSpotBookTickerQuote } from "../src/data/binance-spot-quote-contract.js";
import { createPaperTradingEngine, deriveManagedLots, paperSetupOrderId } from "../src/paper/paper-trading-engine.js";

const ACCEPTED_REPORT = {
  dataQuality: { status: "PASS" },
  outOfSample: { tradeCount: 180, profitFactor: 1.55, netReturnPct: 18, maxDrawdownPct: 12 },
  walkForward: { folds: [{ netReturnPct: 4 }, { netReturnPct: 2 }, { netReturnPct: -1 }, { netReturnPct: 3 }, { netReturnPct: 1 }] },
  regimeAnalysis: { groups: [
    { regime: "BULLISH_NORMAL", tradeCount: 65, meanNetReturnPct: 0.8 },
    { regime: "BEARISH_NORMAL", tradeCount: 55, meanNetReturnPct: 0.4 },
    { regime: "SIDEWAYS_NORMAL", tradeCount: 60, meanNetReturnPct: 0.2 }
  ] },
  costStress: { profitFactor: 1.12, netReturnPct: 4 },
  blockBootstrap: { maxDrawdownPct: { p95: 22 } },
  evaluatedAt: "2026-11-20T00:00:00.000Z"
};
const PLAN = { entry: 100, evaluatedFill: 100, stop: 95, tp1: 105, tp2: 112, tp3: 120 };
const CANDIDATE = { candidate: true, zone: { lo: 98, hi: 101 }, plan: PLAN };

async function harness({ acceptanceReport = ACCEPTED_REPORT, options = {}, dir, results } = {}) {
  dir ??= await mkdtemp(join(tmpdir(), "tradesys-engine-"));
  let time = 1_800_000_000_000;
  const now = () => time;
  const prices = { BTCUSDT: { bid: 100, ask: 100.1, healthy: true } };
  const session = await createPersistentPaperSession({ filePath: join(dir, "events.jsonl"), now });
  const getFeedSnapshot = () => ({
    feeds: Object.fromEntries(Object.entries(prices).map(([symbol, p]) => [symbol, {
      healthy: p.healthy,
      lastQuote: createBinanceSpotBookTickerQuote({ symbol, eventTime: time, receivedAt: time, bidPrice: p.bid, askPrice: p.ask })
    }]))
  });
  const screener = {
    screener: { status: "COMPLETE", results: results ?? [{ symbol: "BTCUSDT", state: "BUY_CANDIDATE", candidate: CANDIDATE }] }
  };
  const logs = [];
  const engine = createPaperTradingEngine({
    session, getFeedSnapshot, getScreenerSnapshot: async () => screener,
    acceptanceReport, options, now, log: line => logs.push(line)
  });
  return {
    dir, session, engine, prices, screener, logs,
    advance: ms => { time += ms; },
    snapshot: () => session.snapshot(),
    cleanup: async () => { await engine.stop(); await session.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); }
  };
}
const fills = state => state.ledger.events.filter(e => e.type === "ORDER_FILLED").map(e => e.payload.order);

test("without an accepted strategy report, the engine never opens positions", async () => {
  for (const report of [null, { dataQuality: { status: "PASS" } }]) {
    const h = await harness({ acceptanceReport: report });
    try {
      const tick = await h.engine.tick();
      assert.match(tick.entriesBlocked, /^ACCEPTANCE_(NOT_EVALUATED|CONDITIONAL)$/);
      assert.equal(fills(await h.snapshot()).length, 0);
      assert.equal(h.engine.status().entriesEnabled, false);
    } finally { await h.cleanup(); }
  }
});

test("an accepted BUY_CANDIDATE is entered once with risk-based sizing and its plan persisted", async () => {
  const h = await harness();
  try {
    const tick = await h.engine.tick();
    const buy = tick.actions.find(a => a.type === "BUY");
    assert.ok(buy, JSON.stringify(tick.actions));
    const fill = 100.1 * 1.0005;
    const expected = Math.floor(10_000 * 0.005 / (fill - 95) * 1e8) / 1e8;
    assert.equal(buy.quantity, expected);
    assert.equal(buy.clientOrderId, paperSetupOrderId("BTCUSDT", CANDIDATE));
    const state = await h.snapshot();
    const filled = state.ledger.events.find(e => e.type === "ORDER_FILLED");
    assert.deepEqual(filled.payload.orderInput.paperPlan, { stop: 95, tp1: 105, tp2: 112, tp3: 120 });
    // Next ticks: held symbol is not re-entered, open position gets marked.
    h.advance(1_000);
    const again = await h.engine.tick();
    assert.equal(again.actions.filter(a => a.type === "BUY").length, 0);
    assert.ok(again.actions.some(a => a.type === "MARK"));
    assert.equal(fills(await h.snapshot()).length, 1);
  } finally { await h.cleanup(); }
});

test("position sizing is capped by maxPositionPct and skips below minimum notional", async () => {
  const h = await harness({ options: { riskPerTradePct: 5, maxPositionPct: 10 } });
  try {
    const buy = (await h.engine.tick()).actions.find(a => a.type === "BUY");
    assert.equal(buy.quantity, Math.floor(10_000 * 0.10 / (100.1 * 1.0005) * 1e8) / 1e8);
  } finally { await h.cleanup(); }
  const tiny = await harness({ options: { riskPerTradePct: 0.0001 } });
  try {
    const tick = await tiny.engine.tick();
    assert.ok(tick.actions.some(a => a.reason === "BELOW_MIN_NOTIONAL"));
  } finally { await tiny.cleanup(); }
});

test("entries are skipped when the live price no longer fits the plan", async () => {
  const cases = [
    [{ bid: 94, ask: 94.1 }, "PRICE_OUTSIDE_PLAN"],
    [{ bid: 106, ask: 106.1 }, "PRICE_OUTSIDE_PLAN"],
    [{ bid: 104, ask: 104.1 }, "CURRENT_RR_BELOW_MINIMUM"],
    [{ bid: 101.5, ask: 101.6 }, "ENTRY_DRIFT_EXCEEDED"]
  ];
  for (const [price, reason] of cases) {
    const h = await harness();
    try {
      Object.assign(h.prices.BTCUSDT, price);
      const tick = await h.engine.tick();
      assert.ok(tick.actions.some(a => a.reason === reason), reason + ": " + JSON.stringify(tick.actions));
      assert.equal(fills(await h.snapshot()).length, 0);
    } finally { await h.cleanup(); }
  }
});

test("TP1 sells 40% and moves the stop to breakeven; a later dip exits the rest", async () => {
  const h = await harness();
  try {
    await h.engine.tick();
    Object.assign(h.prices.BTCUSDT, { bid: 105.5, ask: 105.6 });
    h.advance(1_000);
    const tp1 = await h.engine.tick();
    assert.ok(tp1.actions.some(a => a.type === "SELL" && a.clientOrderId.endsWith("_tp1")), JSON.stringify(tp1.actions));
    let state = await h.snapshot();
    const [lot] = deriveManagedLots(state.ledger.events, state.broker.positions);
    assert.equal(lot.stage, 1);
    assert.equal(lot.activeStop, lot.entryPrice);
    Object.assign(h.prices.BTCUSDT, { bid: 100, ask: 100.1 });
    h.advance(1_000);
    const exit = await h.engine.tick();
    assert.ok(exit.actions.some(a => a.type === "SELL" && a.clientOrderId.endsWith("_exit")), JSON.stringify(exit.actions));
    state = await h.snapshot();
    assert.equal(state.broker.positions.length, 0);
    // The same setup is never re-entered after it was traded.
    h.advance(1_000);
    const after = await h.engine.tick();
    assert.ok(after.actions.some(a => a.reason === "SETUP_ALREADY_TRADED"));
    assert.equal(fills(await h.snapshot()).filter(o => o.side === "BUY").length, 1);
  } finally { await h.cleanup(); }
});

test("stop loss exits the whole position at stage 0", async () => {
  const h = await harness();
  try {
    await h.engine.tick();
    Object.assign(h.prices.BTCUSDT, { bid: 94.9, ask: 95 });
    h.advance(1_000);
    await h.engine.tick();
    const state = await h.snapshot();
    assert.equal(state.broker.positions.length, 0);
    const sell = fills(state).find(o => o.side === "SELL");
    assert.ok(sell.clientOrderId.endsWith("_exit"));
    assert.ok(sell.realizedPnl < 0);
  } finally { await h.cleanup(); }
});

test("full TP1 -> TP2 -> TP3 sequence survives a restart between targets", async () => {
  let h = await harness();
  const dir = h.dir;
  try {
    await h.engine.tick();
    Object.assign(h.prices.BTCUSDT, { bid: 106, ask: 106.1 });
    h.advance(1_000);
    await h.engine.tick();
    await h.engine.stop();
    await h.session.close();
  } catch (error) { await h.cleanup(); throw error; }
  // Restart: a fresh engine derives the stage from durable ledger fills.
  h = await harness({ dir });
  try {
    h.advance(10_000);
    Object.assign(h.prices.BTCUSDT, { bid: 113, ask: 113.1 });
    await h.engine.tick();
    h.advance(1_000);
    Object.assign(h.prices.BTCUSDT, { bid: 121, ask: 121.1 });
    await h.engine.tick();
    const state = await h.snapshot();
    assert.equal(state.broker.positions.length, 0);
    const sells = fills(state).filter(o => o.side === "SELL").map(o => o.clientOrderId.split("_").at(-1));
    assert.deepEqual(sells, ["tp1", "tp2", "exit"]);
    assert.ok(state.broker.cash > 10_000, "profitable round trip");
    assert.equal(h.session.recoveryAudit().status, "PASS");
  } finally { await h.cleanup(); }
});

test("without a healthy quote nothing is marked, exited or entered for that symbol", async () => {
  const h = await harness();
  try {
    await h.engine.tick();
    h.prices.BTCUSDT.healthy = false;
    Object.assign(h.prices.BTCUSDT, { bid: 90, ask: 90.1 });
    h.advance(31_000);
    const tick = await h.engine.tick();
    assert.ok(tick.actions.some(a => a.type === "MARK_SKIPPED"));
    assert.ok(tick.actions.some(a => a.type === "EXIT_SKIPPED"));
    assert.equal((await h.snapshot()).broker.positions.length, 1);
  } finally { await h.cleanup(); }
});

test("a latched kill switch blocks entries but exits keep working", async () => {
  const h = await harness();
  try {
    await h.engine.tick();
    await h.session.activateKillSwitch("OPERATOR_STOP");
    h.screener.screener.results.push({ symbol: "ETHUSDT", state: "BUY_CANDIDATE", candidate: { ...CANDIDATE, zone: { lo: 1, hi: 2 } } });
    h.prices.ETHUSDT = { bid: 100, ask: 100.1, healthy: true };
    Object.assign(h.prices.BTCUSDT, { bid: 94, ask: 94.1 });
    h.advance(1_000);
    const tick = await h.engine.tick();
    assert.equal(tick.entriesBlocked, "KILL_SWITCH_LATCHED");
    assert.ok(tick.actions.some(a => a.type === "SELL"));
    assert.equal((await h.snapshot()).broker.positions.length, 0);
  } finally { await h.cleanup(); }
});

test("marks are throttled to markIntervalMs while positions are open", async () => {
  const h = await harness();
  try {
    await h.engine.tick();
    for (let i = 0; i < 10; i++) { h.advance(5_000); await h.engine.tick(); }
    const marks = (await h.snapshot()).ledger.events.filter(e => e.type === "POSITION_MARKED").length;
    assert.equal(marks, 2, "50 s of 5 s ticks with a 30 s mark interval");
  } finally { await h.cleanup(); }
});

test("runtime: paper trading is off by default and, when enabled, surfaces the acceptance decision", async () => {
  const { startBinanceSpotPaperDashboardRuntime } = await import("../src/paper/binance-spot-paper-dashboard-runtime.js");
  const { parseBinanceSpotDashboardCliArgs } = await import("../src/paper/binance-spot-dashboard-cli-config.js");
  const feedFactory = () => ({ start() {}, stop() {}, checkHealth: () => ({ healthy: false, reason: "NO_RECENT_QUOTE" }), getLastQuote: () => null, getState: () => "CONNECTED" });
  const strategyProvider = async () => ({ screener: { status: "COMPLETE", results: [] }, signal: null, acceptance: { decision: "NOT_EVALUATED" } });
  const dir = await mkdtemp(join(tmpdir(), "tradesys-engine-runtime-"));
  try {
    const off = await startBinanceSpotPaperDashboardRuntime({ filePath: join(dir, "a.jsonl"), feedFactory, strategyProvider, port: 0, log: () => {} });
    assert.equal(off.paperTradingStatus(), null);
    await off.close();

    const logs = [];
    const on = await startBinanceSpotPaperDashboardRuntime({
      filePath: join(dir, "b.jsonl"), feedFactory, strategyProvider, port: 0,
      paperTrading: { acceptanceReport: ACCEPTED_REPORT }, log: line => logs.push(line)
    });
    try {
      assert.equal(on.paperTradingStatus().entriesEnabled, true);
      assert.ok(logs.some(l => l.includes("entries ENABLED")));
      const payload = await (await fetch("http://127.0.0.1:" + on.address().port + "/api/paper-dashboard")).json();
      assert.equal(payload.viewModel.strategy.decision, "ACCEPT");
      assert.equal(payload.viewModel.permissions.maySubmitOrders, false, "the HTTP surface stays read-only");
    } finally { await on.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }

  assert.equal(parseBinanceSpotDashboardCliArgs(["--ledger", "x.jsonl"]).paperTrading, false);
  const cli = parseBinanceSpotDashboardCliArgs(["--ledger", "x.jsonl", "--paper-trading", "--acceptance-report", "r.json"]);
  assert.equal(cli.paperTrading, true);
  assert.ok(cli.acceptanceReportPath.endsWith("r.json"));
  assert.throws(() => parseBinanceSpotDashboardCliArgs(["--ledger", "x.jsonl", "--acceptance-report", "r.json"]), /requires --paper-trading/);
});
