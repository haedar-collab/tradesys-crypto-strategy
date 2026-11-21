# Stage 4I.32 — Binance Spot Live Market Data Provider Integration

## Scope

This stage connects the existing Binance Spot bookTicker WebSocket feed to the read-only paper dashboard runtime. It does not submit orders, mutate the paper ledger, or enable live trading.

## Components

- `src/data/binance-spot-book-ticker-feed.js`: single-symbol public Binance Spot WebSocket feed, reconnect/backoff, stale watchdog, quote parsing.
- `src/data/binance-spot-book-ticker-supervisor.js`: bounded multi-symbol feed lifecycle and health aggregation.
- `src/data/binance-spot-quote-contract.js`: quote provenance and freshness validation.
- `src/data/binance-spot-dashboard-feed-provider.js`: maps a selected feed into the dashboard provider contract and exposes start/stop lifecycle hooks.
- `src/paper/paper-dashboard-runtime-host.js`: starts a lifecycle-aware feed provider before serving and stops it during shutdown or startup rollback.

## Dashboard usage

Create a provider for the chosen Spot symbol and pass it to the existing runtime host:

```js
import { createBinanceSpotDashboardFeedProvider } from "./src/data/binance-spot-dashboard-feed-provider.js";
import { startPaperDashboardRuntimeHost } from "./src/paper/paper-dashboard-runtime-host.js";

const feedProvider = createBinanceSpotDashboardFeedProvider({ symbol: "BTCUSDT" });
const host = await startPaperDashboardRuntimeHost({
  filePath: "./data/paper-ledger.jsonl",
  feedProvider,
  port: 8787
});
console.log("Dashboard: http://127.0.0.1:" + host.address().port + "/dashboard/");
// On application shutdown: await host.close();
```

The feed uses the public market-data stream and does not require Binance API credentials. Node runtime must provide a compatible global WebSocket implementation; alternatively inject a compatible `WebSocketCtor` through `feedOptions`.

## Safety and data semantics

- A socket open without a valid quote is not treated as a healthy market quote.
- The dashboard uses the exchange event timestamp when present, otherwise the feed adapter explicitly marks local receive time as the timestamp basis.
- Stale or disconnected feeds are not presented as healthy prices.
- The runtime host owns provider lifecycle and stops the feed on graceful shutdown and startup rollback.
- The dashboard remains read-only. The host exposes no order submission method.
- This implementation and deterministic tests do not prove that a live Binance network connection succeeds in every deployment environment.

## Verification

Unit tests use injected fake WebSocket/feed implementations. A passing CI run proves deterministic parsing, validation, lifecycle, and dashboard projection behavior; it does not constitute live exchange connectivity certification.
