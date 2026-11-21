import test from "node:test";
import assert from "node:assert/strict";
import { createBinanceSpotBookTickerSupervisor } from "../src/data/binance-spot-book-ticker-supervisor.js";

function factoryHarness({ failSymbol = null } = {}) {
  const feeds = new Map();
  const factory = options => {
    const symbol = options.symbol;
    const feed = {
      started: false,
      quote: null,
      start() {
        if (symbol === failSymbol) throw new Error("mock start failure");
        this.started = true;
        options.onState({ symbol, state: "CONNECTED" });
      },
      stop() {
        this.started = false;
        options.onState({ symbol, state: "STOPPED" });
      },
      checkHealth() { return { healthy: this.started && this.quote !== null, reason: this.quote ? null : "NO_RECENT_QUOTE" }; },
      getLastQuote() { return this.quote ? { ...this.quote } : null; },
      emitQuote(quote) { this.quote = quote; options.onQuote(quote); }
    };
    feeds.set(symbol, feed);
    return feed;
  };
  return { factory, feeds };
}

test("supervises a bounded set of unique symbol feeds and aggregates health", () => {
  const { factory, feeds } = factoryHarness();
  const received = [];
  const supervisor = createBinanceSpotBookTickerSupervisor({
    symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
    feedFactory: factory,
    onQuote: quote => received.push(quote)
  });
  supervisor.start();
  assert.equal(feeds.size, 3);
  assert.equal(supervisor.getSnapshot().state, "RUNNING");
  assert.equal(supervisor.getSnapshot().healthyCount, 0);
  const quote = { symbol: "BTCUSDT", bid: 100, ask: 101 };
  feeds.get("BTCUSDT").emitQuote(quote);
  assert.deepEqual(received, [quote]);
  const snapshot = supervisor.getSnapshot();
  assert.equal(snapshot.healthyCount, 1);
  assert.deepEqual(snapshot.unhealthySymbols, ["ETHUSDT", "SOLUSDT"]);
  assert.equal(supervisor.getQuote("BTCUSDT").bid, 100);
  assert.equal(supervisor.getQuote("UNKNOWN"), null);
  supervisor.stop();
  assert.equal(supervisor.getSnapshot().state, "STOPPED");
  assert.ok([...feeds.values()].every(feed => !feed.started));
});

test("isolates a per-symbol start failure without preventing other feeds from starting", () => {
  const { factory, feeds } = factoryHarness({ failSymbol: "ETHUSDT" });
  const errors = [];
  const supervisor = createBinanceSpotBookTickerSupervisor({
    symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
    feedFactory: factory,
    onError: event => errors.push(event)
  });
  supervisor.start();
  assert.equal(feeds.get("BTCUSDT").started, true);
  assert.equal(feeds.get("ETHUSDT").started, false);
  assert.equal(feeds.get("SOLUSDT").started, true);
  assert.equal(supervisor.getSnapshot().feeds.ETHUSDT.state, "ERROR");
  assert.equal(errors.length, 1);
  supervisor.stop();
});

test("validates symbol list, uniqueness, maximum size and feed contract", () => {
  const { factory } = factoryHarness();
  assert.throws(() => createBinanceSpotBookTickerSupervisor({ symbols: [], feedFactory: factory }), /non-empty/);
  assert.throws(() => createBinanceSpotBookTickerSupervisor({ symbols: ["BTCUSDT", "BTCUSDT"], feedFactory: factory }), /unique/);
  assert.throws(() => createBinanceSpotBookTickerSupervisor({ symbols: ["bad"], feedFactory: factory }), /uppercase/);
  assert.throws(() => createBinanceSpotBookTickerSupervisor({ symbols: ["BTCUSDT", "ETHUSDT"], maxSymbols: 1, feedFactory: factory }), /maxSymbols/);
  assert.throws(() => createBinanceSpotBookTickerSupervisor({ symbols: ["BTCUSDT"], feedFactory: () => ({}) }), /compatible/);
});

test("supervisor can be stopped before any quote and started idempotently", () => {
  const { factory, feeds } = factoryHarness();
  const supervisor = createBinanceSpotBookTickerSupervisor({ symbols: ["BTCUSDT"], feedFactory: factory });
  supervisor.stop();
  supervisor.start();
  supervisor.start();
  assert.equal(feeds.get("BTCUSDT").started, true);
  supervisor.stop();
  supervisor.stop();
  assert.equal(supervisor.getSnapshot().state, "STOPPED");
});


test("clears a prior startup diagnostic after the symbol reconnects successfully", () => {
  const feeds = new Map();
  let shouldFail = true;
  const supervisor = createBinanceSpotBookTickerSupervisor({
    symbols: ["BTCUSDT"],
    feedFactory: options => {
      const feed = {
        started: false,
        start() {
          if (shouldFail) throw new Error("temporary startup failure");
          this.started = true;
          options.onState({ symbol: "BTCUSDT", state: "CONNECTED" });
        },
        stop() {
          this.started = false;
          options.onState({ symbol: "BTCUSDT", state: "STOPPED" });
        },
        checkHealth() { return { healthy: this.started, reason: this.started ? null : "FEED_NOT_CONNECTED" }; },
        getLastQuote() { return null; }
      };
      feeds.set("BTCUSDT", feed);
      return feed;
    }
  });

  supervisor.start();
  assert.equal(supervisor.getSnapshot().errors.BTCUSDT, "temporary startup failure");
  supervisor.stop();
  shouldFail = false;
  supervisor.start();
  assert.equal(supervisor.getSnapshot().feeds.BTCUSDT.state, "CONNECTED");
  assert.equal(supervisor.getSnapshot().errors.BTCUSDT, undefined);
  supervisor.stop();
});
