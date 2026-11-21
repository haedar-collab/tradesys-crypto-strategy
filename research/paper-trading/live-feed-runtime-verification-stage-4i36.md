# Stage 4I.36 — Live Feed Runtime Verification

## Objective

Verify the multi-symbol Binance Spot public bookTicker feed's runtime state transitions and ensure unhealthy quotes are never presented as usable dashboard data.

## Changes

- Preserve the supervisor's concrete per-symbol startup error in the dashboard feed status instead of masking it with a generic no-quote reason.
- Add deterministic tests for:
  - all configured symbols healthy => aggregate `CONNECTED`;
  - one symbol becomes stale => aggregate `DEGRADED`;
  - stale selected symbol => selected quote is `null`;
  - a fresh valid quote restores that symbol and aggregate health;
  - a symbol startup exception is visible in its own diagnostic reason;
  - startup failure never fabricates or exposes a quote.

## Safety properties

- A quote is exposed only when that symbol's own health check is healthy.
- Aggregate health does not upgrade an unhealthy symbol.
- A failed or stale selected symbol never supplies the dashboard's selected quote.
- This stage adds no API credentials, private endpoints, order execution, or mutation controls.
- Runtime integration tests use deterministic mock feeds. They are not evidence of a successful external Binance WebSocket connection.

## Live verification still required

Run the manual GitHub Actions workflow **Binance Spot Live WebSocket Smoke** on branch `feature/app-data-contract-v1`:

1. Open the repository's Actions tab.
2. Select **Binance Spot Live WebSocket Smoke**.
3. Choose **Run workflow** for `feature/app-data-contract-v1`.
4. Confirm the job succeeds and the JSON report lists all five symbols under `passed` with `success: true`.

The smoke test checks public WSS bookTicker messages for BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, and XRPUSDT. A successful deterministic CI suite does not replace this network check.

## Scope boundary

The runtime remains local loopback, read-only, and `PAPER_ONLY`. No live trading is enabled or implied.
