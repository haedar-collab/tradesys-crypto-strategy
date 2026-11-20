# Application Data Contract v1 — Strategy Consumer

The strategy repository consumes the application's versioned Binance Spot research payload.

- Rejects unsupported schema versions and non-Binance-Spot venues.
- Requires exactly one symbol per replay payload.
- Validates ISO as-of timestamp and strictly increasing UTC millisecond evaluation times.
- Validates OHLCV shape, monotonic open times, close/open relationship and closed-candle flag for Weekly/Daily/4H/1H.
- Calls the existing causal historical MTF replay only after validation.
- Returns research decisions only; this adapter cannot place orders.

The application producer and this consumer are independently versioned. Contract changes require coordinated tests in both repositories. Real downloaded data and full event-driven fill simulation are not covered by these contract unit tests.
