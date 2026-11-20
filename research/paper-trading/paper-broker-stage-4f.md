# Stage 4F — Paper Broker and Execution Ledger

## Purpose
Provide a deterministic local paper-only execution adapter. It simulates Binance Spot-style long-only BUY/SELL market fills from a supplied bid/ask quote. It does not connect to Binance, store API credentials, transmit orders, or authorize live trading.

## Safety gates
- Strategy acceptance must be decision=ACCEPT and eligibleForPaperTrading=true.
- Portfolio risk gate must explicitly return allowed=true.
- Quote timestamp must be a UTC millisecond integer, not future-dated, and within maxQuoteAgeMs.
- Only BUY and SELL spot orders are supported; no leverage, margin, shorting, or derivatives.
- Client order IDs are idempotent within the broker process.
- Insufficient cash and overselling are rejected.

## Execution assumptions
BUY fills at ask plus configured fixed slippage; SELL fills at bid minus configured fixed slippage. Fees are charged in quote currency using feeBps. This is a simplified top-of-book model; it does not model depth, partial fills, queue position, market impact, exchange filters, or latency.

## State
The initial implementation is in-memory only. Orders and events are deterministic within one process but are not durable across restarts. Persistence, reconciliation, and replay-safe restart recovery are required before long-running paper sessions.

## Tests
Covers BUY/SELL lifecycle, cash/inventory accounting, idempotency, strategy and risk gates, stale/future quote rejection, insufficient funds, oversell prevention, and mark-to-market valuation.

## Prohibited scope
This module must remain paper-only. Do not add live exchange order endpoints or API key handling as part of this stage.
