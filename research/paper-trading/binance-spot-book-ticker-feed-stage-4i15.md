# Stage 4I.15 — Binance Spot WebSocket Book Ticker Adapter

## Status

Implemented and CI-verified. The adapter is a single-symbol, public Binance Spot WebSocket consumer. It does not require API keys and does not place orders.

## Files

- `src/data/binance-spot-book-ticker-feed.js`
- `tests/binance-spot-book-ticker-feed.test.js`

## Contract

Create a feed with `createBinanceSpotBookTickerFeed({ symbol, WebSocketCtor, ... })`. The WebSocket constructor is injected so browser/Node transports and deterministic test doubles can be supplied without adding a runtime dependency.

The default endpoint is `wss://stream.binance.com:9443/ws`; the adapter appends the lowercase `<symbol>@bookTicker` stream. It currently manages one symbol per feed instance.

On each valid Binance bookTicker payload, the adapter emits a normalized quote containing:

- exchange/source/transport/feed status metadata
- symbol and stream
- bid and ask
- update ID
- event and receive timestamps
- `eventTimeBasis` to distinguish exchange event time from local receive time

**Timestamp caveat:** Binance Spot `<symbol>@bookTicker` payloads do not consistently include an exchange event-time field. When `E` is absent, the adapter sets `eventTime = receivedAt` and labels the basis `LOCAL_RECEIVE_TIME`. This is not an exchange-origin timestamp and must not be interpreted as one.

## Lifecycle and failure behavior

- States: `STOPPED`, `CONNECTING`, `CONNECTED`, `STALE`, `DISCONNECTED`, `RECONNECT_WAIT`.
- Reconnect uses bounded exponential backoff. Backoff resets only after a valid quote, not merely after a socket opens.
- A watchdog marks the feed stale and closes the socket if no valid quote arrives within `staleAfterMs`.
- `stop()` cancels reconnect/watchdog timers and invalidates the active socket generation.
- Events from superseded sockets are ignored.
- Malformed JSON, wrong symbol, invalid update ID, and invalid/crossed bid/ask are reported through `onError`; no quote is emitted.
- `checkHealth()` exposes a synchronous health snapshot. Consumers should check it before using a quote and still validate quote age at the execution boundary.

## Verification

GitHub Actions run `44850219612` passed on branch `feature/app-data-contract-v1`:

- 333 tests passed
- 0 failures
- deterministic mock WebSocket and fake timers; no external network dependency

Covered: URL/stream selection, quote parsing, event-time fallback, malformed and mismatched messages, disconnect/reconnect, stale watchdog, stop behavior, stale socket events, and health reporting.

## Explicit limitations / next work

1. No live Binance network handshake was run in CI; a green mock test is not proof of live endpoint availability.
2. This is a one-symbol feed. A bounded multi-symbol supervisor, aggregate health view, and coordinated shutdown are separate work.
3. No ping/pong telemetry, exchange sequence-gap detection, connection metrics, or production-grade observability is implemented.
4. The adapter emits provenance-bearing quotes but does not itself write paper-ledger marks or submit orders. The caller must pass quotes into the existing paper-session boundary with `requireMarketDataProvenance: true`.
5. Application-level provenance is an adapter assertion, not cryptographic proof of Binance origin. Do not accept caller-fabricated metadata as trusted production data.
6. This is public market data only. No credentials, private account stream, order routing, live execution, or auto-trading are included.

## Readiness

**GO for deterministic adapter tests and controlled paper-data integration. NO-GO for unattended production use or claims of verified live connectivity.** The next logical stage is a multi-symbol feed supervisor with per-symbol health, bounded resource use, and integration tests that connect the adapter output to persistent paper-session marks.
