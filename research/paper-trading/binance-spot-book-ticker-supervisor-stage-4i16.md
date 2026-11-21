# Stage 4I.16 — Multi-Symbol Binance Spot Book Ticker Supervisor

## Status

Implemented and CI-verified on `feature/app-data-contract-v1`.

## Files

- `src/data/binance-spot-book-ticker-supervisor.js`
- `tests/binance-spot-book-ticker-supervisor.test.js`

## Responsibilities

The supervisor coordinates multiple instances of the single-symbol adapter from Stage 4I.15. It does not merge order books, synthesize quotes, or submit orders.

- Accepts a non-empty list of unique uppercase Binance Spot symbols.
- Enforces a configurable `maxSymbols` limit (default: 20).
- Creates one independent feed per symbol using an injectable `feedFactory`.
- Starts/stops feeds idempotently.
- Isolates a synchronous start failure to the affected symbol while continuing to start the remaining feeds.
- Forwards quote, state, and error callbacks.
- Exposes per-symbol `checkHealth()`, `getQuote(symbol)`, and aggregate `getSnapshot()`.
- Reports healthy count, unhealthy symbols, and per-symbol errors.

## Verification

GitHub Actions run `44850349322` passed:

- 337 tests passed
- 0 failures

Supervisor-specific coverage includes bounded/unique symbol validation, health aggregation, quote forwarding, partial start failure isolation, and idempotent lifecycle behavior.

## Limitations

1. The supervisor is an orchestration layer over independent WebSocket connections, not a combined-stream transport. A 20-symbol configuration means up to 20 sockets.
2. There is no global connection budget across multiple supervisor instances; the application must enforce one supervisor per configured watchlist.
3. Per-symbol stale detection and reconnect are delegated to each feed instance.
4. This stage does not persist quotes or marks. Consumers must explicitly route validated quote envelopes into the paper-session API.
5. No real Binance network session was performed as part of CI. Tests use deterministic feed doubles and mock sockets.
6. No private account stream, API credentials, order execution, or auto-trading is included.

## Readiness

**GO for controlled multi-symbol paper-data orchestration under the configured symbol cap. NO-GO for unattended production operation or verified live-feed claims.** Next, integrate supervisor output with the paper-session mark pipeline and prove that disconnected/stale symbols cannot silently refresh portfolio marks.
