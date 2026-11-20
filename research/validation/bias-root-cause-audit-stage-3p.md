# Stage 3P — Weekly/Daily Bias Root-Cause Audit

## Purpose
Summarize the evidence already emitted by causal MTF replay and signal diagnostics. This is a read-only diagnostic; it must not modify bias rules, regime rules, or entry gates.

## Evidence
- Weekly structure trend and EMA50/EMA200 relationship
- Daily structure trend and EMA50/EMA200 relationship
- Effective/raw regime and confirmation status
- 4H structure
- First blocking gate and context readiness

## Interpretation
A Neutral or Mixed bias is not automatically a defect. The current classifier requires aligned structure and EMA evidence for Bullish/Bearish outcomes. The audit reports distributions and does not relax those requirements.

## Limitations
The first blocking gate can conceal later blockers. Counts describe only the supplied replay sample. No fills, fees, slippage, trade returns, or profitability are inferred.
