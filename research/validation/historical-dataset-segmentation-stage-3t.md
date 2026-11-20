# Stage 3T — Historical Dataset Segmentation

## Deliverables
- Causal trailing-return regime labels for descriptive segmentation.
- Chronological training, validation, and separately returned holdout splits.
- Configurable purge and embargo bars to reduce boundary leakage.
- Regime buckets for bullish, bearish, and sideways observations.

## Important limitations
The regime classifier is a trailing-return proxy. It is not the production strategy's MTF regime engine and must not be treated as ground truth. Thresholds and lookback must be pre-registered on training data. The current helper segments one bar series; multi-timeframe alignment, candle-close availability, symbol synchronization, survivorship, and missing data remain caller responsibilities.

## Holdout discipline
The holdout split is returned separately for controlled final evaluation. Never pass holdout into ablation, threshold selection, or parameter tuning. Preserve chronological order and include adequate warm-up data using only preceding observations.

## Data provenance
No Binance data is embedded in this module. The live data acquisition layer must supply validated, timestamp-ordered OHLC bars before this segmentation is used.
