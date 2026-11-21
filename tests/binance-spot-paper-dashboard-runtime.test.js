import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_BINANCE_SPOT_DASHBOARD_SYMBOLS,
  startBinanceSpotPaperDashboardRuntime
} from "../src/paper/binance-spot-paper-dashboard-runtime.js";

function mockFactory(options) {
  let state = "STOPPED";
  let quote = null;
  return {
    start() { state = "CONNECTED"; },
    stop() { state = "STOPPED"; },
    checkHealth() {
      return { healthy: state === "CONNECTED" && quote !== null, ageMs: 2,
        reason: quote ? null : "NO_RECENT_QUOTE" };
    },
    getLastQuote() { return quote; },
    getState() { return state; }
  };
}

test("bootstrap wires five public market feeds into loopback paper dashboard", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tradesys-binance-runtime-"));
  const runtime = await startBinanceSpotPaperDashboardRuntime({
    filePath: join(dir, "paper-ledger.jsonl"),
    feedFactory: mockFactory,
    port: 0
  });
  try {
    assert.deepEqual(runtime.symbols, DEFAULT_BINANCE_SPOT_DASHBOARD_SYMBOLS);
    assert.equal(runtime.selectedSymbol, "BTCUSDT");
    const response = await fetch("http://127.0.0.1:" + runtime.address().port + "/api/paper-dashboard");
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.viewModel.mode, "PAPER_ONLY");
    assert.equal(payload.viewModel.market.state, "WAIT_DATA");
    assert.equal(payload.viewModel.market.symbolCount, 5);
    assert.equal(payload.viewModel.market.healthySymbolCount, 0);
    assert.equal(payload.viewModel.permissions.maySubmitOrders, false);
  } finally {
    await runtime.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("bootstrap rejects invalid mode and requires persistent ledger", async () => {
  await assert.rejects(startBinanceSpotPaperDashboardRuntime(), /filePath/);
  const dir = await mkdtemp(join(tmpdir(), "tradesys-binance-runtime-mode-"));
  try {
    await assert.rejects(startBinanceSpotPaperDashboardRuntime({
      filePath: join(dir, "ledger.jsonl"),
      sessionOptions: { mode: "LIVE" },
      feedFactory: mockFactory
    }), /PAPER_ONLY/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test("end-to-end runtime serves five feeds, degrades safely, recovers, and shuts down cleanly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tradesys-binance-runtime-e2e-"));
  const filePath = join(dir, "paper-ledger.jsonl");
  const feeds = new Map();
  const stopped = new Set();
  const clock = 1_800_000_000_000;
  const feedFactory = options => {
    const feed = {
      state: "STOPPED",
      quote: null,
      start() {
        this.state = "CONNECTED";
        options.onState({ state: this.state, symbol: options.symbol });
      },
      stop() {
        this.state = "STOPPED";
        stopped.add(options.symbol);
        options.onState({ state: this.state, symbol: options.symbol });
      },
      checkHealth() {
        const healthy = this.state === "CONNECTED" && this.quote !== null;
        return {
          healthy,
          ageMs: healthy ? 1 : null,
          reason: healthy ? null : this.state === "STALE" ? "QUOTE_STALE" : "NO_RECENT_QUOTE"
        };
      },
      getLastQuote() { return this.quote ? { ...this.quote } : null; },
      publishQuote() {
        this.state = "CONNECTED";
        this.quote = {
          symbol: options.symbol,
          eventTime: clock,
          receivedAt: clock,
          bid: 100,
          ask: 101,
          source: "BINANCE_SPOT_WS_BOOK_TICKER",
          eventTimeBasis: "LOCAL_RECEIVE_TIME"
        };
        options.onQuote(this.quote);
      }
    };
    feeds.set(options.symbol, feed);
    return feed;
  };

  const runtime = await startBinanceSpotPaperDashboardRuntime({
    filePath,
    feedFactory,
    now: () => clock,
    port: 0
  });
  const base = "http://127.0.0.1:" + runtime.address().port;
  try {
    assert.equal(runtime.address().address, "127.0.0.1");
    assert.equal((await fetch(base + "/healthz")).status, 200);

    let response = await fetch(base + "/api/paper-dashboard");
    assert.equal(response.status, 200);
    let payload = await response.json();
    assert.equal(payload.viewModel.market.state, "WAIT_DATA");
    assert.equal(payload.viewModel.market.symbolCount, 5);
    assert.equal(payload.viewModel.market.healthySymbolCount, 0);
    assert.deepEqual(payload.viewModel.market.feeds.map(item => item.symbol), [
      "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"
    ]);

    for (const feed of feeds.values()) feed.publishQuote();
    response = await fetch(base + "/api/paper-dashboard");
    payload = await response.json();
    assert.equal(payload.viewModel.market.state, "HEALTHY");
    assert.equal(payload.viewModel.market.healthySymbolCount, 5);
    assert.equal(payload.viewModel.market.symbol, "BTCUSDT");
    assert.equal(payload.viewModel.market.bid, 100);
    assert.equal(payload.viewModel.market.ask, 101);

    feeds.get("BTCUSDT").state = "STALE";
    response = await fetch(base + "/api/paper-dashboard");
    payload = await response.json();
    assert.equal(payload.viewModel.market.state, "DEGRADED");
    assert.equal(payload.viewModel.market.healthySymbolCount, 4);
    assert.equal(payload.viewModel.market.bid, null);
    assert.equal(payload.viewModel.market.ask, null);
    assert.equal(payload.viewModel.market.feeds.find(item => item.symbol === "BTCUSDT").healthy, false);

    feeds.get("BTCUSDT").publishQuote();
    response = await fetch(base + "/api/paper-dashboard");
    payload = await response.json();
    assert.equal(payload.viewModel.market.state, "HEALTHY");
    assert.equal(payload.viewModel.market.healthySymbolCount, 5);
    assert.equal(payload.viewModel.market.bid, 100);

    assert.equal(payload.viewModel.permissions.readOnly, true);
    assert.equal(payload.viewModel.permissions.maySubmitOrders, false);
    assert.equal(JSON.stringify(payload).includes("ledgerSnapshot"), false);
  } finally {
    await runtime.close();
    assert.deepEqual([...stopped].sort(), [
      "BNBUSDT", "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"
    ]);
    const ledger = await readFile(filePath, "utf8");
    assert.match(ledger, /SESSION_STOPPED/);
    await rm(dir, { recursive: true, force: true });
  }
});
