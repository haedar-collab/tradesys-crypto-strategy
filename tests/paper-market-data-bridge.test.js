import test from "node:test";
import assert from "node:assert/strict";
import { createPaperMarketDataBridge } from "../src/paper/paper-market-data-bridge.js";

const NOW = 1_800_000_000_000;
function quote(symbol, overrides = {}) {
  return {
    exchange: "BINANCE", source: "BINANCE_SPOT_WS_BOOK_TICKER", transport: "WSS",
    feedStatus: "CONNECTED", symbol, stream: symbol.toLowerCase() + "@bookTicker",
    eventTime: NOW - 100, receivedAt: NOW - 50, bid: 100, ask: 100.1,
    updateId: 123, ...overrides
  };
}
function harness({ positions = [{ symbol: "BTCUSDT", quantity: 1 }], quotes = {}, health = {} } = {}) {
  const calls = [];
  const supervisor = {
    checkHealth: () => health,
    getQuote: symbol => quotes[symbol] ?? null
  };
  const session = {
    snapshot: async () => ({ broker: { positions } }),
    markToMarket: async value => {
      calls.push(value);
      return { equity: 1_000, marks: Object.keys(value) };
    }
  };
  const bridge = createPaperMarketDataBridge({ supervisor, session, now: () => NOW, maxQuoteAgeMs: 5_000 });
  return { bridge, calls };
}

test("marks every open position only after every held symbol passes feed health and provenance checks", async () => {
  const btc = quote("BTCUSDT");
  const eth = quote("ETHUSDT", { bid: 200, ask: 200.1 });
  const { bridge, calls } = harness({
    positions: [{ symbol: "BTCUSDT", quantity: 1 }, { symbol: "ETHUSDT", quantity: 2 }],
    quotes: { BTCUSDT: btc, ETHUSDT: eth },
    health: { BTCUSDT: { healthy: true }, ETHUSDT: { healthy: true } }
  });
  const result = await bridge.markOpenPositions();
  assert.equal(result.status, "MARKED");
  assert.deepEqual(result.symbols, ["BTCUSDT", "ETHUSDT"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].BTCUSDT.source, "BINANCE_SPOT_WS_BOOK_TICKER");
  assert.equal(calls[0].ETHUSDT.bid, 200);
});

test("blocks the entire portfolio mark if any held symbol is disconnected or stale", async () => {
  const { bridge, calls } = harness({
    positions: [{ symbol: "BTCUSDT", quantity: 1 }, { symbol: "ETHUSDT", quantity: 1 }],
    quotes: {
      BTCUSDT: quote("BTCUSDT"),
      ETHUSDT: quote("ETHUSDT", { eventTime: NOW - 10_000, receivedAt: NOW - 9_999 })
    },
    health: {
      BTCUSDT: { healthy: true },
      ETHUSDT: { healthy: false, reason: "FEED_NOT_CONNECTED" }
    }
  });
  await assert.rejects(bridge.markOpenPositions(), error => {
    assert.equal(error.code, "PAPER_MARKET_DATA_UNAVAILABLE");
    assert.deepEqual(error.rejected, [{ symbol: "ETHUSDT", reason: "FEED_NOT_CONNECTED" }]);
    return true;
  });
  assert.equal(calls.length, 0);
});

test("blocks missing and invalid quotes without writing a partial mark", async () => {
  const { bridge, calls } = harness({
    positions: [{ symbol: "BTCUSDT", quantity: 1 }, { symbol: "SOLUSDT", quantity: 1 }],
    quotes: { BTCUSDT: quote("BTCUSDT"), SOLUSDT: quote("ETHUSDT") },
    health: { BTCUSDT: { healthy: true }, SOLUSDT: { healthy: true } }
  });
  await assert.rejects(bridge.markOpenPositions(), error => {
    assert.deepEqual(error.rejected, [{ symbol: "SOLUSDT", reason: "SYMBOL_OR_STREAM_MISMATCH" }]);
    return true;
  });
  assert.equal(calls.length, 0);
});

test("returns without writing when the paper portfolio is flat", async () => {
  const { bridge, calls } = harness({ positions: [] });
  assert.deepEqual(await bridge.markOpenPositions(), { status: "NO_OPEN_POSITIONS", marks: [] });
  assert.equal(calls.length, 0);
});

test("validates required bridge dependencies and freshness settings", () => {
  assert.throws(() => createPaperMarketDataBridge({}), /supervisor/);
  assert.throws(() => createPaperMarketDataBridge({
    supervisor: { checkHealth() {}, getQuote() {} },
    session: { snapshot() {}, markToMarket() {} },
    maxQuoteAgeMs: 0
  }), /maxQuoteAgeMs/);
});
