# Stage 4I.37 — Feed Diagnostic Recovery

## Objective

Ensure transient and startup feed errors remain actionable without becoming permanent stale diagnostics after a feed successfully reconnects.

## Change

The multi-symbol feed supervisor now clears the stored per-symbol error when that feed publishes a `CONNECTED` state. This keeps the dashboard's diagnostic reason aligned with the current lifecycle instead of retaining a historical startup failure after recovery.

## Verification

- Startup failure records a per-symbol diagnostic.
- Stopping and restarting the supervisor retries the failed symbol.
- A subsequent successful `CONNECTED` state clears the previous diagnostic.
- Existing multi-symbol stale/healthy gating and selected-quote behavior remain unchanged.
- CI test suite: 410 tests, 410 passed, 0 failed.

## Operational boundary

This is deterministic lifecycle testing with mock feeds. It does not prove external Binance WebSocket reachability. The manual **Binance Spot Live WebSocket Smoke** workflow remains the required real-network check for BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, and XRPUSDT.

The dashboard remains local loopback, read-only, and PAPER_ONLY. No exchange credentials or live order execution are introduced.
