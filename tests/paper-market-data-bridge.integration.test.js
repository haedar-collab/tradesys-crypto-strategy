import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistentPaperSession } from "../src/paper/persistent-paper-session.js";
import { createPaperMarketDataBridge } from "../src/paper/paper-market-data-bridge.js";
import { createBinanceSpotBookTickerQuote } from "../src/data/binance-spot-quote-contract.js";

const ACCEPT = { decision: "ACCEPT", eligibleForPaperTrading: true };

test("supervisor quote reaches the persistent paper ledger only through a healthy fail-closed bridge", async () => {
  const now = 1_800_000_000_000;
  const dir = await mkdtemp(join(tmpdir(), "tradesys-market-bridge-integration-"));
  const filePath = join(dir, "events.jsonl");
  const quote = () => createBinanceSpotBookTickerQuote({
    symbol: "BTCUSDT", eventTime: now - 100, receivedAt: now - 50,
    bidPrice: "100", askPrice: "100.1"
  });
  let healthy = true;
  let session;
  try {
    session = await createPersistentPaperSession({
      filePath, now: () => now, requireMarketDataProvenance: true
    });
    await session.submitMarketOrder({
      clientOrderId: "bridge_integration_buy", symbol: "BTCUSDT", side: "BUY", quantity: 1,
      quote: quote(), strategyAcceptance: ACCEPT
    });

    const supervisor = {
      checkHealth: () => ({ BTCUSDT: { healthy, reason: healthy ? null : "FEED_NOT_CONNECTED" } }),
      getQuote: () => quote()
    };
    const bridge = createPaperMarketDataBridge({
      supervisor, session, now: () => now, maxQuoteAgeMs: 5_000
    });

    const marked = await bridge.markOpenPositions();
    assert.equal(marked.status, "MARKED");
    assert.deepEqual(marked.symbols, ["BTCUSDT"]);
    const afterMark = await session.snapshot();
    const markEvents = afterMark.ledger.events.filter(event => event.type === "POSITION_MARKED");
    assert.equal(markEvents.length, 1);
    assert.equal(markEvents[0].payload.marketDataProvenance[0].source, "BINANCE_SPOT_WS_BOOK_TICKER");

    healthy = false;
    await assert.rejects(bridge.markOpenPositions(), error => {
      assert.equal(error.code, "PAPER_MARKET_DATA_UNAVAILABLE");
      assert.deepEqual(error.rejected, [{ symbol: "BTCUSDT", reason: "FEED_NOT_CONNECTED" }]);
      return true;
    });
    const afterBlockedMark = await session.snapshot();
    assert.equal(afterBlockedMark.ledger.events.filter(event => event.type === "POSITION_MARKED").length, 1);
    await session.close();
  } finally {
    if (session) await session.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});
