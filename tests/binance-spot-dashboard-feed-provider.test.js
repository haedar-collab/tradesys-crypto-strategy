import test from "node:test";
import assert from "node:assert/strict";
import { createBinanceSpotDashboardFeedProvider } from "../src/data/binance-spot-dashboard-feed-provider.js";

class FakeFeed {
  constructor(options) { this.options = options; this.state = "STOPPED"; this.quote = null; this.starts = 0; this.stops = 0; }
  start() { this.starts += 1; this.state = "CONNECTING"; }
  stop() { this.stops += 1; this.state = "STOPPED"; }
  getState() { return this.state; }
  getLastQuote() { return this.quote; }
  emitState(state) { this.state = state; this.options.onState({ state }); }
  emitQuote(quote) { this.quote = quote; this.options.onQuote(quote); }
}

test("dashboard provider maps a fresh Binance quote into the runtime snapshot contract", async () => {
  let feed;
  const provider = createBinanceSpotDashboardFeedProvider({
    symbol: "BTCUSDT",
    feedFactory: options => (feed = new FakeFeed(options))
  });
  await provider();
  assert.equal((await provider()).status.state, "DISCONNECTED");
  provider.start();
  feed.emitState("CONNECTED");
  const quote = {
    symbol: "BTCUSDT", eventTime: 1_800_000_000_000, receivedAt: 1_800_000_000_010,
    bid: 100, ask: 101, source: "BINANCE_SPOT_WS_BOOK_TICKER",
    eventTimeBasis: "LOCAL_RECEIVE_TIME"
  };
  feed.emitQuote(quote);
  const snapshot = await provider();
  assert.equal(snapshot.status.state, "CONNECTED");
  assert.equal(snapshot.status.transportState, "CONNECTED");
  assert.deepEqual(snapshot.quote, {
    symbol: "BTCUSDT", timestamp: quote.eventTime, receivedAt: quote.receivedAt,
    bid: 100, ask: 101, source: quote.source, eventTimeBasis: quote.eventTimeBasis
  });
  provider.stop();
  assert.equal((await provider()).status.state, "DISCONNECTED");
});

test("dashboard provider does not report a socket connection as healthy before first quote", async () => {
  let feed;
  const provider = createBinanceSpotDashboardFeedProvider({
    symbol: "ETHUSDT",
    feedFactory: options => (feed = new FakeFeed(options))
  });
  provider.start();
  feed.emitState("CONNECTED");
  const snapshot = await provider();
  assert.equal(snapshot.status.state, "CONNECTED");
  assert.equal(snapshot.quote, null);
  provider.stop();
});

test("dashboard provider validates symbol and feed contract", () => {
  assert.throws(() => createBinanceSpotDashboardFeedProvider({ symbol: "btc" }), /symbol/);
  assert.throws(() => createBinanceSpotDashboardFeedProvider({ symbol: "BTCUSDT", feedFactory: () => ({}) }), /compatible/);
});

test("dashboard provider forwards stale transport state with its last quote", async () => {
  let feed;
  const provider = createBinanceSpotDashboardFeedProvider({
    symbol: "SOLUSDT",
    feedFactory: options => (feed = new FakeFeed(options))
  });
  provider.start();
  const quote = { symbol: "SOLUSDT", eventTime: 100, receivedAt: 100, bid: 10, ask: 11, source: "BINANCE_SPOT_WS_BOOK_TICKER" };
  feed.emitQuote(quote);
  feed.emitState("STALE");
  const snapshot = await provider();
  assert.equal(snapshot.status.state, "CONNECTED");
  assert.equal(snapshot.status.transportState, "STALE");
  assert.equal(snapshot.quote.timestamp, 100);
  provider.stop();
});
