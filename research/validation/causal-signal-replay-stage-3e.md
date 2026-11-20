# Causal Signal Replay — Stage 3E

## Implementation

`src/backtest/causal-replay.js` provides:
- `runCausalReplay`: prefix-only closed-candle replay. Each callback receives only bars from the beginning through the current bar.
- `runCausalFeatureReplay`: recomputes indicators, confirmed structure events, bullish order blocks, FVGs, liquidity, and regime from each available prefix.
- `runCausalSignalReplay`: passes the current prefix and feature snapshot to a caller-provided context builder and pure strategy evaluator.
- `assertCausalPrefixInvariant`: metamorphic check that mutations to future bars do not change outputs before the mutation point.

## Causality rules

1. Input candles must be complete and strictly timestamp ordered. The caller is responsible for supplying closed candles; exchange close status cannot be proven from OHLCV values alone.
2. A decision at candle close may not be filled at an earlier price within that same candle. Execution begins no earlier than the next eligible event/candle under the chosen fill model.
3. All indicators and structural features are recalculated from the current prefix, not from a full-history array containing future candles.
4. Pivots are only actionable after their right-side confirmation bars have closed.
5. The context builder and strategy evaluator must be pure, deterministic, and must not fetch future or external data.
6. Multi-timeframe contexts must be independently aligned by their closed-candle timestamps and pass strict as-of validation.

## Tests

`tests/causal-replay.test.js` checks prefix-only visibility, immutable replay inputs, future-candle mutation invariance, malformed OHLCV rejection, feature replay, and causal decision replay.

## Limitations

- This module supplies a safe replay boundary but does not yet provide the production multi-timeframe context builder for Weekly/Daily/4H/1H.
- It does not fetch or verify Binance historical data.
- It does not independently prove that an external evaluator is pure; the caller's implementation must be audited.
- A future-mutation invariant test is a necessary diagnostic, not proof against every possible form of lookahead or data leakage.

## Acceptance criteria

- [ ] CI passes on the strategy branch.
- [ ] Production context builder consumes only closed, timestamp-aligned timeframe prefixes.
- [ ] Strategy decision evaluator is deterministic and contains no network access or hidden future state.
- [ ] Historical Binance Spot replay uses reproducible data snapshots and realistic fees/slippage.
- [ ] Walk-forward and untouched holdout call the causal signal replay path, not precomputed full-history signals.
- [ ] Paper replay matches event-driven simulation within documented tolerances.
