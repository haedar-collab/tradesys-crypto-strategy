# Stage 4I.33 — Live Feed Operational Verification

## Purpose
A manually triggered network smoke test for Binance Spot public WebSocket bookTicker streams. It uses no API key, secret, account permission, or order endpoint.

## Runtime baseline
The repository runtime baseline is Node.js 22 or newer. The feed uses the built-in global WebSocket implementation.

## Local execution
```bash
node scripts/binance-spot-live-smoke.js
```

The script checks the first valid quote for BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, and XRPUSDT, validates freshness and quote structure, then closes each socket. Each symbol has a 20-second timeout.

## GitHub Actions
Open Actions → Binance Spot Live WebSocket Smoke → Run workflow. It is manual-only; regular CI does not depend on exchange network availability.

## Pass criteria
All five symbols must produce a fresh, structurally valid quote within the timeout. A blocked or failed connection is a failed smoke test, not a code-test pass.

## Limits
- A passing run proves public WebSocket connectivity from that GitHub Actions runner at that time only.
- It does not prove connectivity from the user's local machine, hosting provider, or production network.
- It does not certify uptime, latency guarantees, exchange execution, strategy quality, or profitability.
- The integration is market-data read-only. No Binance credentials or order execution are used.
