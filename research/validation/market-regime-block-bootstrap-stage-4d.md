# Stage 4D — Market Regime Analysis and Moving-Block Bootstrap

## Market regime labels
The classifier labels each observation using trailing close-to-close return over a configured lookback and trailing realized volatility. At index i it uses observations only through i. It emits direction (BULLISH, BEARISH, SIDEWAYS) and volatility (HIGH, NORMAL). Thresholds and sampling frequency must be explicitly calibrated to the benchmark and market.

Trade attribution uses the regime label at exact entry timestamp. Trades without an exact matching label are retained as UNCLASSIFIED rather than silently dropped.

## Block bootstrap
The non-circular moving-block bootstrap samples contiguous blocks of sequential closed-trade net returns. This preserves local order within each block, unlike independent resampling. It reports return/equity quantiles, drawdown quantiles and probability of loss.

## Constraints
- Use only out-of-sample trades with fees and slippage already deducted.
- Keep the original chronological sequence for regime attribution.
- This is a diagnostic, not a signal or a guarantee of future performance.
- Block bootstrap assumes blocks are exchangeable and cannot fully model regime transitions, liquidity shocks, serial dependence beyond selected block length, or structural breaks.
- Threshold-based regimes are descriptive labels and depend on lookback, sampling interval, benchmark and thresholds.

## Tests
Covers bullish/bearish/sideways labels, trailing timestamp behavior, entry-time attribution, unclassified trades, deterministic block bootstrap and configuration validation.

## Next
Connect this module to the actual walk-forward out-of-sample trade ledger; test exact timestamp alignment and run per-asset and per-regime reports. Define acceptance thresholds only after reviewing data coverage, sample size and realistic execution assumptions.
