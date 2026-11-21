# Stage 4I.19 — Paper Market Data Runtime Lifecycle

## Status

Implemented and CI-verified on `feature/app-data-contract-v1`.

## Files

- `src/paper/paper-market-data-runtime.js`
- `tests/paper-market-data-runtime.test.js`

## Responsibilities

`createPaperMarketDataRuntime({ supervisor, bridge, markIntervalMs, ... })` coordinates the lifecycle of the multi-symbol feed supervisor and explicit paper portfolio marking.

- `start()` starts the supervisor and schedules the first mark after the configured interval.
- `markNow()` requests an immediate mark through the fail-closed bridge.
- Concurrent `markNow()` calls coalesce into one in-flight bridge operation.
- Periodic marks use recursive timeouts scheduled after the previous mark completes, preventing overlapping periodic marks.
- Periodic failures are surfaced through `onError`; the cadence continues while the runtime remains active.
- `stop()` cancels the pending timer, stops the supervisor, and waits for any in-flight mark to settle.
- The runtime never closes the persistent paper session and never submits orders.

## Verification

GitHub Actions run `44850663856` passed:

- 348 tests passed
- 0 failures

New tests cover idempotent start/stop, single recursive cadence, concurrent mark coalescing, error reporting with continued cadence, shutdown waiting for an in-flight mark, and configuration validation.

## Operational boundaries

1. Mark cadence is explicit and configurable; the default is one second and should be tuned to the application’s risk and resource budget.
2. This runtime does not persist its own process state. A process restart requires a fresh supervisor/runtime instance and normal paper-session recovery.
3. A hung bridge call delays the next periodic mark and causes `stop()` to wait. Production deployment should add an outer process watchdog and operational alerting.
4. No market-data feed is considered healthy merely because the runtime is started; the bridge still requires per-symbol feed health and fresh quote provenance.
5. No real Binance connection was exercised by CI. Tests use deterministic fakes.
6. No live trading, private account stream, API keys, or auto-trading are included.

## Readiness

**GO for controlled in-process paper-data lifecycle and non-overlapping mark cadence. NO-GO for unattended production deployment until real network reconnect behavior, process supervision, metrics/alerts, and deployment shutdown are verified.**
