import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistentPaperSession } from "../src/paper/persistent-paper-session.js";
import { createBinanceSpotBookTickerQuote } from "../src/data/binance-spot-quote-contract.js";
import { submitStrategyBuyToPaper } from "../src/paper/strategy-paper-execution.js";

const NOW = 1_800_000_000_000;
const passingReport = () => ({
  dataQuality: { status: "PASS" },
  outOfSample: { tradeCount: 180, profitFactor: 1.55, netReturnPct: 18, maxDrawdownPct: 12 },
  walkForward: { folds: [
    { netReturnPct: 4 }, { netReturnPct: 2 }, { netReturnPct: -1 },
    { netReturnPct: 3 }, { netReturnPct: 1 }
  ] },
  regimeAnalysis: { groups: [
    { regime: "BULLISH_NORMAL", tradeCount: 65, meanNetReturnPct: 0.8 },
    { regime: "BEARISH_NORMAL", tradeCount: 55, meanNetReturnPct: 0.4 },
    { regime: "SIDEWAYS_NORMAL", tradeCount: 60, meanNetReturnPct: 0.2 }
  ] },
  costStress: { profitFactor: 1.12, netReturnPct: 4 },
  blockBootstrap: { maxDrawdownPct: { p95: 22 } },
  evaluatedAt: "2026-11-20T00:00:00.000Z"
});
const quote = () => createBinanceSpotBookTickerQuote({
  symbol: "BTCUSDT", eventTime: NOW - 100, receivedAt: NOW - 50,
  bidPrice: "100", askPrice: "100.1"
});
const signal = () => ({
  clientOrderId: "strategy_paper_buy_01",
  symbol: "BTCUSDT", side: "BUY", quantity: 1
});

test("strategy acceptance blocks incomplete evidence before any paper order intent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tradesys-strategy-paper-block-"));
  let session;
  try {
    session = await createPersistentPaperSession({
      filePath: join(dir, "events.jsonl"), now: () => NOW,
      requireMarketDataProvenance: true
    });
    const result = await submitStrategyBuyToPaper({
      session, acceptanceReport: { dataQuality: { status: "PASS" } },
      signal: signal(), quote: quote()
    });
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.reason, "CONDITIONAL");
    const snapshot = await session.snapshot();
    assert.equal(snapshot.ledger.events.filter(e => e.type === "ORDER_SUBMITTED").length, 0);
    assert.equal(snapshot.broker.positions.length, 0);
    await session.close();
  } finally {
    if (session) await session.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

test("only internally accepted strategy evidence can create a provenance-validated paper BUY", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tradesys-strategy-paper-accept-"));
  let session;
  try {
    session = await createPersistentPaperSession({
      filePath: join(dir, "events.jsonl"), now: () => NOW,
      requireMarketDataProvenance: true
    });
    const result = await submitStrategyBuyToPaper({
      session, acceptanceReport: passingReport(), signal: signal(), quote: quote()
    });
    assert.equal(result.status, "SUBMITTED_TO_PAPER");
    assert.equal(result.mode, "PAPER_ONLY");
    assert.equal(result.acceptance.decision, "ACCEPT");
    assert.equal(result.order.status, "FILLED");
    const snapshot = await session.snapshot();
    assert.equal(snapshot.ledger.events.filter(e => e.type === "ORDER_SUBMITTED").length, 1);
    assert.equal(snapshot.ledger.events.filter(e => e.type === "ORDER_FILLED").length, 1);
    assert.equal(snapshot.broker.positions[0].symbol, "BTCUSDT");
    await session.close();
  } finally {
    if (session) await session.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

test("hard-rejected strategy evidence never reaches the paper broker", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tradesys-strategy-paper-reject-"));
  let session;
  try {
    session = await createPersistentPaperSession({
      filePath: join(dir, "events.jsonl"), now: () => NOW,
      requireMarketDataProvenance: true
    });
    const report = passingReport();
    report.outOfSample.profitFactor = 0.8;
    const result = await submitStrategyBuyToPaper({
      session, acceptanceReport: report, signal: signal(), quote: quote()
    });
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.reason, "REJECT");
    const snapshot = await session.snapshot();
    assert.equal(snapshot.ledger.events.filter(e => e.type === "ORDER_SUBMITTED").length, 0);
    await session.close();
  } finally {
    if (session) await session.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});
