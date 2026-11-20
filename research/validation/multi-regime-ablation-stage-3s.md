# Stage 3S — Multi-Regime Controlled Ablation

## Scope
Training-fold-only comparison across Bullish, Bearish, and Sideways market regimes. This is a research harness, not a claim that live Binance regime-stratified results have been produced.

## Requirements
- Regime labels must be assigned causally at each evaluation timestamp using only information available then.
- Folds must be non-overlapping in time; prevent leakage across boundaries and account for warm-up.
- Apply identical capital, fee, slippage, risk, and execution assumptions to every scenario.
- Rebuild indicators, multi-timeframe context, and signals independently for every ablation.
- Use the same event-driven or portfolio simulator for all scenarios.
- Report trade count and flag results below the configured minimum sample size.
- Keep untouched holdout sealed until scenario selection and conclusions are frozen.

## Interpretation
A regime-specific result can be noisy, especially with few trades. Do not rank a scenario from return alone: inspect net return, marked-equity drawdown, profit factor, trade count, and consistency across regimes. The harness cannot itself prove that upstream regime labels or time folds are causal; those are caller responsibilities.
