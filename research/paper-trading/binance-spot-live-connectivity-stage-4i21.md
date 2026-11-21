# Stage 4I.21 — Binance Spot Live Connectivity Smoke Check

## Purpose

Provide a deliberate, read-only manual check that the local runtime can open a real Binance Spot WebSocket connection and receive one valid public bookTicker quote.

## Command

From the repository root, with a supported Node.js runtime exposing `globalThis.WebSocket` (Node.js 22 or later recommended):

```bash
node scripts/binance-spot-live-smoke.js BTCUSDT
```

Optional timeout (milliseconds):

```bash
BINANCE_SMOKE_TIMEOUT_MS=30000 node scripts/binance-spot-live-smoke.js ETHUSDT
```

Supported symbols must be uppercase Binance Spot symbols. The script uses the public stream endpoint through the existing adapter. It requires no API key, secret, account permission, or paid service.

## Success criteria

The script exits with code 0 and prints `LIVE_QUOTE_RECEIVED` only after receiving a quote whose symbol, source, WSS transport, feed status, bid/ask, and receive age pass the smoke-check conditions.

It reports the adapter's `eventTimeBasis`. Binance Spot `bookTicker` payloads may not contain an exchange event timestamp; in that case the adapter correctly labels the timestamp as `LOCAL_RECEIVE_TIME`.

## Failure criteria

- `LIVE_QUOTE_TIMEOUT`: no acceptable quote arrived before the configured timeout.
- `INVALID_LIVE_QUOTE`: received quote failed validation.
- Exit code 2: invalid arguments or unavailable WebSocket runtime.

A timeout can be caused by DNS, proxy, firewall, TLS, network policy, endpoint reachability, or exchange-side availability. It is not proof that the adapter itself is defective.

## Safety boundary

This is a public market-data read-only check. It does not submit orders, authenticate to a Binance account, write to the paper ledger, or prove order execution, sustained uptime, production latency, reconnect resilience, or strategy profitability.

## Evidence status

The smoke-check script is committed as `scripts/binance-spot-live-smoke.js`. A real connectivity result is **not claimed** until the user runs it in an environment with outbound WebSocket access and records the output.
