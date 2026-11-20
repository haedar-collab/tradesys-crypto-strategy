# Portfolio Stress Testing — Stage 2

## Purpose

Evaluate the multi-symbol Binance Spot portfolio simulator under deterministic adverse price paths, rising cross-asset correlation, and a modeled recovery path. This is a robustness experiment, not a probability forecast.

## Implemented

- `src/backtest/portfolio-stress.js` exposes `runPortfolioStress(input, scenarios)`.
- Per-symbol OHLC shocks apply from a selected aligned bar index.
- Optional linear recovery returns the shock multiplier to baseline at `recoveryEndIndex`.
- Optional correlation stress blends each asset's daily return series toward the equal-weight cross-asset mean. A blend of 1 creates identical return series.
- Reports pairwise correlation summary, ending equity, net return, max drawdown, trades, open positions, skipped entries, and drawdown-guard state.
- Signals are held fixed to isolate price-path and portfolio-risk-gate behavior.

## Example scenario design

- Baseline: no shock and no correlation blend.
- Concentration: one altcoin -8%, -20%, and -35%.
- Broad market: BTC and all held altcoins shocked together.
- Correlation spike: correlationBlend 0.5 and 1.0.
- Asymmetric stress: BTC -10%, high-beta altcoins -25%.
- Recovery: shock then linear recovery to the original price factor by a later bar.

## Interpretation and limitations

1. Correlation blending modifies the return metadata used by the portfolio gate; it does not synthesize a historically observed crisis regime.
2. Price shocks alter OHLC paths but signals and trade plans remain fixed. This intentionally does not model signal regeneration or endogenous strategy behavior.
3. Recovery is a deterministic linear multiplier path, not a forecast or a model of volatility during recovery.
4. No order-book depth, spread widening, market impact, queue priority, delisting, exchange outage, or forced liquidation cascade is simulated.
5. The model must not be described as measuring a guaranteed maximum loss.

## Validation

Run `npm test` with Node.js 20+. Tests cover downside shocks, correlation blending, recovery path, immutable baseline input, and invalid scenario/data rejection.

## Exit criteria

- [ ] CI passes on the latest commit.
- [ ] Run against representative multi-asset historical data with aligned bars and returns.
- [ ] Review exposure cap, max positions, correlation block, and drawdown guard under simultaneous stress.
- [ ] Record actual scenario results before declaring portfolio stress testing complete.
