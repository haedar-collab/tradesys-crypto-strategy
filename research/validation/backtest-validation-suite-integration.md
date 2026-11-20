# Backtest Validation Suite Integration

## What is integrated

`src/backtest/validation-suite.js` binds the research validators to the actual deterministic Spot simulators:

- Event-driven single-symbol runner: `runEventBacktest`
- Multi-symbol portfolio runner: `runPortfolioBacktest`
- Parameter sensitivity adapters for both runners
- Walk-forward adapters for both runners
- Locked untouched-holdout adapters for both runners

## Why this matters

Previously, the validation harness accepted arbitrary injected runners. This remains useful for unit tests, but it is not sufficient evidence about the actual trading simulation. These adapters provide a standard path to run the same validation protocols against the repository's real execution/accounting code.

## Data and signal limitation

The adapters do not create signals. Inputs must contain signals generated causally using only information available at each signal close. Walk-forward and holdout slice supplied signals and re-index them; they do not recompute indicators or strategy decisions within each fold. This is a known limitation and must be resolved before claiming fully leakage-resistant performance.

## Reproducible research run requirements

Record:
- strategy repository commit SHA;
- data provider, symbol list, interval, snapshot IDs and timezone;
- candle closed-time convention and as-of timestamp;
- signal-generation version and parameter hash;
- fee tier assumptions, feeBps, slippageBps and fill model;
- training, walk-forward, and final holdout index/time boundaries;
- complete per-window metrics and all failed/negative scenarios.

## Acceptance

- [ ] CI passes with integration tests.
- [ ] Actual signal generation is rerun causally within each fold, or precomputed signals are proven to be causal and fold-independent.
- [ ] Historical Binance Spot snapshots are used, with survivorship and delisting bias addressed.
- [ ] Fee/slippage assumptions are tested over conservative ranges.
- [ ] Final holdout remains untouched after parameter freeze.
- [ ] Paper-trading replay agrees with the simulator within documented tolerances.

This integration is an engineering milestone, not a profitability claim or authorization for live/automated orders.
