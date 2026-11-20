# Stage 4E — Strategy Acceptance Engine

## Purpose
Evaluate an evidence bundle and return ACCEPT, CONDITIONAL, or REJECT. This is a deterministic policy gate; it does not run a backtest, calculate missing metrics, generate signals, or place orders.

## Default policy thresholds
- At least 100 out-of-sample trades.
- Out-of-sample profit factor >= 1.20.
- Positive out-of-sample net return.
- Out-of-sample maximum drawdown <= 20%.
- At least 3 walk-forward folds and >= 60% positive folds.
- At least 20 trades in every reported regime group.
- Worst defined fee/slippage stress profit factor >= 1.00 and positive net return.
- Block-bootstrap P95 maximum drawdown <= 30%.
- Data quality status must be PASS.

Thresholds are explicit configurable policy defaults, not universal evidence-based truths. They must be reviewed against the strategy horizon, asset universe, sample size, and account-specific execution costs before operational use.

## Decision semantics
- REJECT: at least one measured hard gate fails.
- CONDITIONAL: no hard gate fails, but one or more required evidence items are missing or underpowered.
- ACCEPT: all required evidence is present and every hard gate passes.

ACCEPT grants eligibility for controlled paper trading only. It never authorizes live trading.

## Input contract
The report must provide dataQuality.status, outOfSample metrics, walkForward.folds with netReturnPct, regimeAnalysis.groups, worst-case costStress metrics, and blockBootstrap.maxDrawdownPct.p95.

All performance inputs must be sourced from chronologically valid out-of-sample results, with fees and slippage included where specified. Do not use training metrics as acceptance evidence.

## Known limitations
- Regime groups are evaluated as supplied; the caller must guarantee timestamp-causal attribution and must include unclassified trades in its evidence accounting.
- The policy does not yet verify cross-asset generalization or sample independence.
- Monte Carlo/bootstrap quantiles are diagnostics, not guarantees.
- The module is a gate over supplied evidence, not an independent verifier of provenance.

## Tests
Covers ACCEPT, CONDITIONAL, REJECT, weak cost stress, underpowered regimes, fold consistency, and invalid inputs.
