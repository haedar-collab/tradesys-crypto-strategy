# Walk-Forward Evaluation — Stage 3

## Purpose

Select candidate risk/management parameters on a chronological training window and evaluate the selected candidate on a later, separate test window. This reduces the risk of reporting in-sample optimization as out-of-sample performance.

## Implementation

- `src/backtest/walk-forward.js` exports `runWalkForward(input, options)`.
- Supports single-symbol bars and aligned multi-symbol portfolio inputs.
- Each window uses zero-based bar indices with exclusive end indices.
- Candidate parameters are evaluated on training data only; the best training metric is selected and evaluated on the later test slice.
- Signals are sliced and re-indexed within each window.
- Reports training candidate metrics, selected parameters, and out-of-sample net return, drawdown, trade count, and ending equity.

## Research protocol

1. Define chronological training and test windows before examining results.
2. Use multiple sequential windows; do not choose window boundaries based on observed test performance.
3. Keep a final untouched holdout period outside all parameter-selection decisions.
4. Evaluate net returns after fees and slippage, alongside max drawdown, trade count, exposure, and profit factor.
5. Compare candidate stability across windows; do not select a parameter solely because one test window is exceptional.
6. Report all attempted candidates and windows, including negative outcomes.

## Important limitations

- The runner consumes supplied signals and does not regenerate strategy signals or indicator features inside each fold. If supplied signals were computed with future data, slicing alone cannot remove that leakage.
- Parameter candidates should be restricted to parameters that the supplied backtest runner actually consumes.
- This is a deterministic evaluation harness, not a statistical guarantee of future returns.
- A separate final holdout and historical Binance data replay are still required.

## Validation

Run `npm test` using Node.js 20+. Unit tests cover training-only selection, later test evaluation, chronological boundaries, multiple windows, invalid inputs, and aligned multi-asset slicing.

## Exit criteria

- [ ] CI passes.
- [ ] Integrate the actual event-driven and portfolio simulators as runners.
- [ ] Verify candidate parameters are consumed by those simulators and do not alter test data.
- [ ] Add a final untouched holdout and report per-window results on representative Binance Spot history.
- [ ] Confirm signal generation itself is causal and timestamp-aligned before treating walk-forward output as valid strategy evidence.
