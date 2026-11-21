# Stage 4I.14 — Binance Spot Quote Provenance & Feed Validation

## Objective

Introduce an explicit application-level contract for live Binance Spot best-bid/best-ask quotes and an opt-in fail-closed gate in the persistent paper session. The goal is to prevent malformed, mismatched, stale, future-dated, or disconnected-feed quotes from being used for paper order simulation or portfolio marks.

## Implementation

### Quote contract

File: `src/data/binance-spot-quote-contract.js`

- `createBinanceSpotBookTickerQuote(...)` normalizes a Binance Spot `<symbol>@bookTicker` message into a quote envelope.
- `validateBinanceSpotQuote(...)` checks:
  - exchange `BINANCE`;
  - source `BINANCE_SPOT_WS_BOOK_TICKER`;
  - transport `WSS`;
  - feed state `CONNECTED`;
  - exact symbol and expected lower-case bookTicker stream;
  - positive bid/ask with ask not below bid;
  - integer UTC millisecond event and receive timestamps;
  - event time not after receive time;
  - neither timestamp is in the future or older than the configured maximum age.
- Successful validation returns the broker-compatible quote plus provenance metadata.

### Paper-session integration

File: `src/paper/persistent-paper-session.js`

- New opt-in setting: `requireMarketDataProvenance` (default `false` to preserve existing callers).
- When enabled, both order quotes and every portfolio mark quote must pass the contract.
- An invalid order quote is rejected before the write-ahead `ORDER_SUBMITTED` event is persisted.
- Accepted fill events retain the original provenance-bearing input for audit, while the replay input contains the normalized broker quote.
- `POSITION_MARKED` events retain per-symbol provenance metadata.
- Immutable session configuration includes the new setting. Existing headers without the field are interpreted as `false`, preserving legacy ledger recovery without silently changing the original mode.

## Tests

- `tests/binance-spot-quote-contract.test.js`: valid quote, source/feed state, symbol/stream mismatch, stale/future timestamps, invalid bid/ask.
- `tests/paper-market-data-provenance.test.js`: fail-closed order quote validation, durable provenance metadata, restart recovery, SELL exit, stale/disconnected mark rejection.
- Full GitHub Actions test run: `44848288868` — SUCCESS.
- Full suite: 325 passed, 0 failed.

The first integration runs exposed a backward-compatibility issue in comparing old immutable session headers after adding the optional configuration field. The comparison and recovery audit were corrected to normalize the absent field to `false` and compare configuration keys canonically. The final full test run passed.

## Important limitations

This stage validates an adapter-provided envelope. It does **not** prove that the metadata is authentic or that a real Binance WebSocket is connected. The adapter that consumes actual Binance WebSocket frames must set the source, stream, connection state, and receive timestamp from the real transport; callers must not be allowed to fabricate these fields as a substitute for a live feed.

The current validator does not yet manage WebSocket lifecycle, reconnect/backoff, ping/pong, sequence continuity, connection generations, rate limits, or a feed-health watchdog. Those belong to the next stage.

No API keys or credentials are required by the public market-data design. No live orders or automated trading are introduced. The system remains signal-only / paper-only.

## Next stage

Stage 4I.15 should implement a real Binance Spot WebSocket bookTicker adapter with explicit connection lifecycle, bounded reconnect/backoff, feed-health state, message parsing, and integration tests using a deterministic mock WebSocket. The adapter should be the only trusted producer of the provenance envelope.
