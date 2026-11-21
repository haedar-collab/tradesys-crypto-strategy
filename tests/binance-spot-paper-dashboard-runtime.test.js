import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
