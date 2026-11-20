# Stage 3V — Binance Spot Historical Kline Acquisition

## Implemented
- Public Binance Spot REST /api/v3/time and /api/v3/klines acquisition.
- UTC millisecond start/end bounds and pagination.
- Supported intervals: 1h, 4h, 1d, 1w.
- OHLCV shape and candle consistency checks.
- Closed-candle filtering against Binance server time.
- Duplicate open-time suppression and chronological output.
- Injected fetch function for deterministic tests; no API key is required for public market data.

## Required operating controls
- Request bounded date ranges and respect Binance request-weight limits.
- On HTTP 429/418 or transient 5xx, caller must use bounded exponential backoff and honor Retry-After where present.
- Run the OHLC dataset validator after acquisition with explicit expected coverage.
- Do not infer completeness from an empty or short page; check expected candle schedule and missing intervals.
- Persist raw response provenance, retrieval time, symbol, interval, and range downstream.

## Not yet implemented
- Persistent storage, scheduling, automatic retry/backoff, multi-symbol orchestration, and complete range-coverage certification.
- No live historical datasets are downloaded in CI; tests use deterministic mocked HTTP responses.
