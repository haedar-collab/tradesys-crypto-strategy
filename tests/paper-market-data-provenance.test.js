import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistentPaperSession } from "../src/paper/persistent-paper-session.js";
import { createBinanceSpotBookTickerQuote } from "../src/data/binance-spot-quote-contract.js";

const ACCEPT = { decision: "ACCEPT", eligibleForPaperTrading: true };
test("provenance-required paper session rejects untrusted quotes and persists accepted source metadata", async () => {
  const now = 1_800_000_000_000;
  const dir = await mkdtemp(join(tmpdir(), "tradesys-provenance-"));
  const filePath = join(dir, "events.jsonl");
  const makeQuote = (overrides = {}) => createBinanceSpotBookTickerQuote({
    symbol: "BTCUSDT", eventTime: now - 100, receivedAt: now - 50,
    bidPrice: "100", askPrice: "100.1", ...overrides
  });
  let session;
  try {
    const config = { filePath, now: () => now, requireMarketDataProvenance: true };
    session = await createPersistentPaperSession(config);
    const input = {
      clientOrderId: "provenance_buy_01", symbol: "BTCUSDT", side: "BUY", quantity: 1,
      quote: { timestamp: now, bid: 100, ask: 100.1 },
      strategyAcceptance: ACCEPT
    };
    await assert.rejects(session.submitMarketOrder(input), /UNTRUSTED_OR_DISCONNECTED_SOURCE/);
    assert.equal((await session.snapshot()).ledger.events.filter(e => e.type === "ORDER_SUBMITTED").length, 0);

    const acceptedInput = { ...input, quote: makeQuote() };
    const fill = await session.submitMarketOrder(acceptedInput);
    assert.equal(fill.status, "FILLED");
    await session.markToMarket({ BTCUSDT: makeQuote() });
    const state = await session.snapshot();
    const fillEvent = state.ledger.events.find(e => e.type === "ORDER_FILLED");
    const markEvent = state.ledger.events.find(e => e.type === "POSITION_MARKED");
    assert.equal(fillEvent.payload.orderInput.quote.source, "BINANCE_SPOT_WS_BOOK_TICKER");
    assert.equal(fillEvent.payload.executionInput.quote.timestamp, now - 100);
    assert.equal(markEvent.payload.marketDataProvenance[0].symbol, "BTCUSDT");
    await session.close();

    session = await createPersistentPaperSession(config);
    assert.equal(session.recoveryAudit().status, "PASS");
    const sell = await session.submitMarketOrder({
      clientOrderId: "provenance_sell_01", symbol: "BTCUSDT", side: "SELL", quantity: 1,
      quote: makeQuote(), strategyAcceptance: ACCEPT
    });
    assert.equal(sell.status, "FILLED");
    await session.close();
  } finally {
    if (session) await session.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

test("provenance-required paper session rejects stale and disconnected portfolio marks", async () => {
  const now = 1_800_000_000_000;
  const dir = await mkdtemp(join(tmpdir(), "tradesys-provenance-mark-"));
  const filePath = join(dir, "events.jsonl");
  const quote = overrides => createBinanceSpotBookTickerQuote({
    symbol: "BTCUSDT", eventTime: now - 100, receivedAt: now - 50,
    bidPrice: "100", askPrice: "100.1", ...overrides
  });
  let session;
  try {
    session = await createPersistentPaperSession({
      filePath, now: () => now, requireMarketDataProvenance: true
    });
    await session.submitMarketOrder({
      clientOrderId: "provenance_mark_buy", symbol: "BTCUSDT", side: "BUY", quantity: 1,
      quote: quote({}), strategyAcceptance: ACCEPT
    });
    await assert.rejects(
      session.markToMarket({ BTCUSDT: quote({ feedStatus: "DISCONNECTED" }) }),
      /UNTRUSTED_OR_DISCONNECTED_SOURCE/
    );
    await assert.rejects(
      session.markToMarket({ BTCUSDT: quote({ eventTime: now - 10_000, receivedAt: now - 9_999 }) }),
      /STALE_MARKET_DATA/
    );
    const mark = await session.markToMarket({ BTCUSDT: quote({}) });
    assert.equal(mark.marks.length, 1);
    await session.close();
  } finally {
    if (session) await session.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});
