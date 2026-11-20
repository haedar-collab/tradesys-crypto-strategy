# Stage 3U — OHLC Dataset Quality

## Scope
A deterministic validation layer for already acquired OHLC bars. This module does not call Binance and does not claim that live or historical data has been downloaded.

## Checks
- Required symbol and supported interval.
- Positive, finite OHLC values and candle high/low consistency.
- Duplicate and out-of-order timestamps.
- Missing interval detection for 1h, 4h, 1d, and 1w.
- Optional first/last timestamp boundary checks.
- Cross-symbol timestamp alignment.

## Acceptance
Only datasets with no malformed rows, duplicates, detected gaps, ordering defects, or supplied boundary gaps are marked COMPLETE. REVIEW_REQUIRED datasets must not be silently repaired or passed to backtests.

## Limitations
The caller must independently establish Binance source provenance, closed-candle status, timezone/interval semantics, pagination completeness, and expected timestamp range. Alignment compares timestamps exactly; it does not resample or fill missing candles.
