# Stage 4I.34 — Multi-Symbol Live Feed Aggregation

## Scope
Adds a lifecycle-aware, read-only dashboard provider over the existing bounded Binance Spot bookTicker supervisor. Default use is five symbols: BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT.

## Health semantics
- DISCONNECTED: provider has not started or has stopped.
- WAIT_DATA: started, but no symbol has a currently healthy quote.
- DEGRADED: at least one symbol is healthy, but not all configured symbols are healthy.
- CONNECTED: every configured symbol has a healthy quote.
- Per-symbol quote is exposed only when that symbol's own supervisor health check is healthy. A stale, disconnected, or failed symbol never exposes its last quote as usable.
- A selected quote is exposed to the existing single-market dashboard contract only if the selected symbol is healthy. Other symbol statuses and quotes are carried as read-only metadata.

## Boundaries
No order execution, API credentials, paid dependency, fallback prices, or fabricated data. This stage does not prove live Binance network connectivity. The manual WebSocket smoke workflow remains a separate operational check.

## Tests
Deterministic fake-feed tests cover partial health, stale selected-symbol suppression, isolated startup failure, lifecycle, and configuration validation.
