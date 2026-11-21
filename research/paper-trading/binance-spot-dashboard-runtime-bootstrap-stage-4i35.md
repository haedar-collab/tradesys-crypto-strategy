# Stage 4I.35 — Runtime Feed Configuration & Bootstrap

## Runtime bootstrap
Adds `startBinanceSpotPaperDashboardRuntime`, which composes the existing PAPER_ONLY runtime host with the multi-symbol public Binance Spot bookTicker provider. The default watchlist is BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, and XRPUSDT; BTCUSDT is selected for the single-quote dashboard panel.

## Lifecycle and safety
- Runtime host starts provider before serving snapshots and stops it during shutdown.
- Startup rollback stops the provider and closes the persistent paper session.
- Dashboard binds only to loopback through the existing HTTP server.
- Feed data remains read-only; no exchange API keys, order execution, or strategy mutation path is added.
- No quote before a valid feed event: market state remains WAIT_DATA and quote remains unavailable.
- A successful bootstrap does not prove live network connectivity; the manual Binance WebSocket smoke workflow is still required.

## Usage
```js
import { startBinanceSpotPaperDashboardRuntime } from "./src/paper/binance-spot-paper-dashboard-runtime.js";

const runtime = await startBinanceSpotPaperDashboardRuntime({
  filePath: "./data/paper-ledger.jsonl",
  port: 8787
});
console.log("Dashboard:", "http://127.0.0.1:" + runtime.address().port + "/dashboard/");
// On shutdown: await runtime.close();
```

## Verification
Deterministic bootstrap tests use injected fake feeds. They verify watchlist defaults, loopback HTTP snapshot, fail-closed WAIT_DATA before first quote, PAPER_ONLY mode, and no order permission. Actual Binance network connectivity remains an external operational check.
