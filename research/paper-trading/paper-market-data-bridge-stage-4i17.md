# Stage 4I.17 — Fail-Closed Paper Market Data Bridge

## Status

Implemented and CI-verified on `feature/app-data-contract-v1`.

## Files

- `src/paper/paper-market-data-bridge.js`
- `tests/paper-market-data-bridge.test.js`

## Behavior

`createPaperMarketDataBridge({ supervisor, session, now, maxQuoteAgeMs })` connects the multi-symbol bookTicker supervisor to the persistent paper-session mark API.

When `markOpenPositions()` is called:

1. Reads the current paper-session snapshot.
2. Returns `NO_OPEN_POSITIONS` without writing a mark when the portfolio is flat.
3. Enumerates every currently open position.
4. Requires a healthy supervisor feed for every held symbol.
5. Retrieves each latest quote and validates Binance Spot provenance, symbol/stream match, bid/ask, timestamp ordering, and maximum quote age.
6. If any held symbol is missing, disconnected, stale, or invalid, rejects the entire mark operation with `PAPER_MARKET_DATA_UNAVAILABLE` and a per-symbol rejection list.
7. Only when every held symbol passes does it call `session.markToMarket(quotes)` once with the complete quote set.

No synthetic price, partial portfolio mark, or fallback price is generated.

## Verification

GitHub Actions run `44850473859` passed:

- 342 tests passed
- 0 failures

New tests cover all-symbol success, disconnected/stale symbol rejection, missing/mismatched quote rejection, flat portfolio behavior, and dependency/config validation.

## Operational constraints

- The bridge is explicitly invoked; it does not run a scheduler or autonomously mark positions.
- Callers must serialize mark invocations with their broader portfolio workflow where required.
- Quote age is validated at bridge time and again by the paper session when provenance enforcement is enabled.
- This does not verify the authenticity of the WebSocket origin cryptographically. The supervisor's adapter must remain the trusted producer.
- No real Binance network connection was exercised by CI.
- No private account data, live order execution, or auto-trading is involved.

## Readiness

**GO for explicit, fail-closed paper portfolio marking using healthy multi-symbol quotes. NO-GO for unattended operation until scheduling, feed supervision, process lifecycle, and live connectivity are separately validated.**
