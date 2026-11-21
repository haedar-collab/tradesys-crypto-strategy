import test from "node:test";
import assert from "node:assert/strict";
import { createBinanceSpotMultiSymbolDashboardFeedProvider } from "../src/data/binance-spot-multi-symbol-dashboard-feed-provider.js";

function harness({ failSymbol = null } = {}) {
  const feeds = new Map();
  const feedFactory = options => {
    const symbol = options.symbol;
    const feed = {
      state: "STOPPED", quote: null,
      start() {
        if (symbol === failSymbol) throw new Error("mock start failure");
        this.state = "CONNECTED";
        options.onState({ state: this.state, symbol });
      },
      stop() { this.state = "STOPPED"; options.onState({ state: this.state, symbol }); },
      checkHealth() {
        const healthy = this.state === "CONNECTED" && this.quote !== null;
        return { healthy, state: this.state, ageMs: healthy ? 5 : null, reason: healthy ? null : "NO_RECENT_QUOTE" };
      },
      getLastQuote() { return this.quote ? { ...this.quote } : null; },
      emitQuote() {
        this.quote = {
          symbol, eventTime: 1_800_000_000_000, receivedAt: 1_800_000_000_001,
          bid: 100, ask: 101, source: "BINANCE_SPOT_WS_BOOK_TICKER",
          eventTimeBasis: "LOCAL_RECEIVE_TIME"
        };
        options.onQuote(this.quote);
      }
    };
    feeds.set(symbol, feed);
    return feed;
  };
  return { feedFactory, feeds };
}

test("aggregates five independent feeds and exposes selected healthy quote only", async () => {
  const { feedFactory, feeds } = harness();
  const provider = createBinanceSpotMultiSymbolDashboardFeedProvider({
    symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"],
    selectedSymbol: "BTCUSDT", feedFactory
  });
  assert.equal((await provider()).status.state, "DISCONNECTED");
  provider.start();
  feeds.get("BTCUSDT").emitQuote();
  feeds.get("ETHUSDT").emitQuote();
  const snapshot = await provider();
  assert.equal(snapshot.status.state, "DEGRADED");
  assert.equal(snapshot.status.healthyCount, 2);
  assert.deepEqual(snapshot.status.unhealthySymbols, ["SOLUSDT", "BNBUSDT", "XRPUSDT"]);
  assert.equal(snapshot.quote.symbol, "BTCUSDT");
  assert.equal(snapshot.status.feeds.SOLUSDT.quote, null);
  provider.stop();
  assert.equal((await provider()).status.state, "DISCONNECTED");
  assert.equal((await provider()).quote, null);
});

test("unhealthy selected symbol never leaks its last quote while another symbol remains healthy", async () => {
  const { feedFactory, feeds } = harness();
  const provider = createBinanceSpotMultiSymbolDashboardFeedProvider({
    symbols: ["BTCUSDT", "ETHUSDT"], selectedSymbol: "BTCUSDT", feedFactory
  });
  provider.start();
  feeds.get("BTCUSDT").emitQuote();
  feeds.get("ETHUSDT").emitQuote();
  feeds.get("BTCUSDT").state = "STALE";
  const snapshot = await provider();
  assert.equal(snapshot.status.state, "DEGRADED");
  assert.equal(snapshot.status.feeds.BTCUSDT.healthy, false);
  assert.equal(snapshot.status.feeds.BTCUSDT.quote, null);
  assert.equal(snapshot.quote, null);
  assert.equal(snapshot.status.feeds.ETHUSDT.healthy, true);
  provider.stop();
});

test("isolates one symbol startup failure and validates configuration", async () => {
  const { feedFactory } = harness({ failSymbol: "ETHUSDT" });
  const provider = createBinanceSpotMultiSymbolDashboardFeedProvider({
    symbols: ["BTCUSDT", "ETHUSDT"], feedFactory
  });
  provider.start();
  const snapshot = await provider();
  assert.equal(snapshot.status.state, "WAIT_DATA");
  assert.equal(snapshot.status.feeds.ETHUSDT.state, "ERROR");
  assert.equal(snapshot.status.feeds.ETHUSDT.reason, "mock start failure");
  assert.throws(() => createBinanceSpotMultiSymbolDashboardFeedProvider({ symbols: [] }), /non-empty/);
  assert.throws(() => createBinanceSpotMultiSymbolDashboardFeedProvider({
    symbols: ["BTCUSDT"], selectedSymbol: "ETHUSDT", feedFactory
  }), /selectedSymbol/);
  provider.stop();
});


test("recovers an individual feed after stale status and reaches CONNECTED only when all feeds are healthy", async () => {
  const { feedFactory, feeds } = harness();
  const provider = createBinanceSpotMultiSymbolDashboardFeedProvider({
    symbols: ["BTCUSDT", "ETHUSDT"], selectedSymbol: "BTCUSDT", feedFactory
  });
  provider.start();
  feeds.get("BTCUSDT").emitQuote();
  feeds.get("ETHUSDT").emitQuote();
  let snapshot = await provider();
  assert.equal(snapshot.status.state, "CONNECTED");
  assert.equal(snapshot.status.healthyCount, 2);

  feeds.get("BTCUSDT").state = "STALE";
  snapshot = await provider();
  assert.equal(snapshot.status.state, "DEGRADED");
  assert.equal(snapshot.quote, null);
  assert.equal(snapshot.status.feeds.BTCUSDT.quote, null);

  feeds.get("BTCUSDT").state = "CONNECTED";
  feeds.get("BTCUSDT").emitQuote();
  snapshot = await provider();
  assert.equal(snapshot.status.state, "CONNECTED");
  assert.equal(snapshot.status.healthyCount, 2);
  assert.equal(snapshot.quote.symbol, "BTCUSDT");
  provider.stop();
});

test("failed symbol startup exposes its concrete diagnostic without fabricating a quote", async () => {
  const { feedFactory } = harness({ failSymbol: "ETHUSDT" });
  const provider = createBinanceSpotMultiSymbolDashboardFeedProvider({
    symbols: ["BTCUSDT", "ETHUSDT"], selectedSymbol: "ETHUSDT", feedFactory
  });
  provider.start();
  const snapshot = await provider();
  assert.equal(snapshot.status.feeds.ETHUSDT.state, "ERROR");
  assert.equal(snapshot.status.feeds.ETHUSDT.reason, "mock start failure");
  assert.equal(snapshot.status.feeds.ETHUSDT.quote, null);
  assert.equal(snapshot.quote, null);
  provider.stop();
});
