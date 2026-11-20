# Untouched Out-of-Sample Holdout — Stage 3B

## Purpose

Evaluate a frozen strategy configuration once on a later period that was not used for parameter selection. This is the final check against repeatedly tuning to historical test results.

## Implementation

- `src/backtest/untouched-holdout.js` exports `runUntouchedHoldout(input, options)`.
- Requires explicit `selectionLocked: true`, a finite `selectionTimestamp`, and a frozen parameter object.
- Requires the first holdout bar timestamp to be strictly later than the parameter-freeze timestamp.
- Has no parameter-candidate or optimization interface.
- Evaluates exactly once and reports net return, max drawdown, trade count, profit factor, ending equity, and win rate when supplied by the runner.
- Supports single-symbol and aligned multi-symbol input.

## Required protocol

1. Use training and walk-forward folds to define the candidate configuration.
2. Record the selected parameter set, strategy code commit, data snapshot, cost assumptions, and selection timestamp.
3. Lock the parameter set before the holdout period begins.
4. Run the holdout exactly once. Do not modify parameters after seeing its result.
5. If the holdout fails, treat that as research feedback; a revised strategy requires a new, genuinely unseen holdout period.

## Important limitation

The evaluator can enforce chronology and require a caller attestation, but it cannot independently prove that a human did not inspect holdout data or that supplied signals were generated causally. Signal-generation leakage, data snooping, delisted-asset survivorship bias, and data quality remain external risks.

## Validation

Run `npm test` on Node.js 20+. Tests cover locked execution, chronology, single evaluation, invalid requests, runner output, and input immutability.

## Exit criteria

- [ ] CI passes.
- [ ] Connect to the actual portfolio backtest runner and real Binance Spot historical snapshots.
- [ ] Freeze a reproducible strategy commit, parameters, data snapshot ID, and cost configuration.
- [ ] Run one holdout period that was not used during parameter selection.
- [ ] Report all outcomes without retuning against holdout results.
