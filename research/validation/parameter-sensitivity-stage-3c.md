# Parameter Sensitivity — Stage 3C

## Objective

Measure how much backtest outcomes change when selected parameters vary while market data, signals, and other settings remain fixed. This is a fragility diagnostic, not an optimization method.

## Implementation

- `src/backtest/parameter-sensitivity.js` exports `runParameterSensitivity(runner, input, parameterSets, options)`.
- Runs every supplied parameter set through the same backtest runner.
- Reports each scenario's net return, max drawdown, profit factor, trade count, and ending equity.
- Reports metric range, median, average return, return dispersion, positive/negative scenario counts, and observed maximum drawdown.
- Supports maximize/minimize direction for descriptive metric ranking.
- Does not select or deploy parameters.

## Suggested sensitivity dimensions

Test one parameter family at a time before combined scenarios:
- risk per trade and position sizing;
- minimum live reward/risk and entry drift tolerance;
- maximum concurrent positions and exposure cap;
- correlation threshold and drawdown guard;
- fee and slippage scenarios using the separate cost sensitivity module.

Use realistic bounded ranges. Avoid huge grids that encourage data mining.

## Interpretation

- A sign change in net return across nearby settings is a warning of parameter fragility.
- Large changes in drawdown or trade count can indicate unstable risk exposure.
- A narrow result range does not prove positive expectancy or future robustness.
- Do not select the best-performing parameter set from the same final holdout period.

## Limitations and acceptance

- The runner must actually consume every parameter being varied.
- Existing supplied signals are held fixed; this does not measure sensitivity of signal generation unless signals are regenerated causally for each parameter set.
- [ ] CI passes.
- [ ] Run on multiple walk-forward folds and representative market regimes.
- [ ] Confirm all varied settings are wired to the production simulator.
- [ ] Keep final holdout untouched and do not retune based on its result.
