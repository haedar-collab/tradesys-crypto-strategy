# Causal Multi-Timeframe Context Builder — Stage 3F

## Implementation

`src/engine/causal-mtf.js` exports:
- `buildCausalMultiTimeframeContext(input, options)`
- `evaluateCausalMultiTimeframeSetup(input, options)`
- `CAUSAL_MTF_INTERVALS`

The builder normalizes Binance Spot kline rows, excludes forming candles, calculates indicators and confirmed structure from each timeframe's closed history, builds the daily market-regime timeline, derives 4H demand zones/liquidity and supplies 1H trigger history to the existing multi-timeframe decision engine.

## Temporal contract

- Evaluation time is an explicit UTC millisecond timestamp.
- A candle is eligible only when `closeTime < evaluationTime`.
- Expected intervals are 1W, 1D, 4H and 1H; interval overrides must be explicit.
- All timeframe contexts carry their latest closed candle's close timestamp.
- Existing as-of freshness validation is applied before a strategy decision is returned.
- Forming candles are excluded, even if present in the input arrays.

## Tests

`tests/causal-mtf.test.js` checks closed-candle selection, exclusion of forming candles, insufficient history, malformed and out-of-order inputs, explicit evaluation time, and guarded strategy evaluation.

## Limitations requiring follow-up

1. The caller must fetch and pass exchange klines; this module has no network dependency.
2. Weekly and daily bars must use the exchange's canonical UTC candle boundaries. Synthetic/custom bars must not be relabelled as exchange candles.
3. The current weekly/daily bias is a conservative trend/EMA summary, not a complete higher-timeframe SMC narrative.
4. Daily regime confirmation requires consecutive raw labels in the current closed daily history.
5. Context construction does not yet regenerate and execute the strategy over every walk-forward fold. That is the next integration requirement.
6. A 1H trigger is evaluated from the full supplied closed 1H history. Any fill must occur after the signal's actual close timestamp.

## Acceptance

- [ ] CI passes for builder and test commits.
- [ ] Verify actual Binance Spot kline boundary/close-time handling on 1W, 1D, 4H and 1H.
- [ ] Validate freshness thresholds across weekends, exchange maintenance, and missing candles.
- [ ] Add production data adapter with deterministic snapshot metadata.
- [ ] Run causal signal replay through this builder for every historical decision timestamp.
- [ ] Integrate with walk-forward and locked final holdout, then compare paper replay with event-driven fills.
