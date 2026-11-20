# Portfolio Stress Testing — Stage 2

## Purpose

Test the existing multi-symbol Spot portfolio simulator against deterministic adverse price-path shocks. The goal is to expose concentration and drawdown fragility, not to predict crash probabilities.

## Implementation

- `src/backtest/portfolio-stress.js` provides `runPortfolioStress(input, scenarios)`.
- Each scenario applies a multiplicative OHLC price shock from a specified aligned bar index onward.
- Multiple symbols can be shocked together, or independently, to examine concentrated exposure.
- Signals and trade plans are held fixed so the experiment isolates price-path and portfolio-risk response.
- Reports ending equity, net return, maximum drawdown, closed trades, remaining open positions, skipped entries, and drawdown guard state.

## Example scenarios

- Baseline path: no shock.
- Single-asset shocks: -8%, -20%, -35%.
- Broad market shock: apply -10% to every active asset at the same index.
- Asymmetric shock: BTC -10%, high-beta altcoins -25% at the same index.
- Recovery path: model recovery by supplying later OHLC bars in the source dataset; a single permanent shock is not a recovery model.

## Important limitations

- This is a deterministic price-path shock, not a probability model or historical crash replay.
- Correlation metadata (`dailyReturns`) is not recomputed after shocks. A correlation-regime stress test is still required.
- The model does not simulate order-book depth, market impact, liquidity gaps beyond the OHLC bars, delistings, exchange outages, or cross-asset contagion.
- Existing risk gates may prevent entries; report skipped signals and open exposure alongside returns.
- Do not interpret these scenarios as a guarantee of maximum possible loss.

## Validation

Run `npm test` on Node.js 20+. The new tests cover downside response, immutable inputs, invalid scenarios, and invalid runner output.

## Exit criteria

- [ ] CI passes.
- [ ] Run single-asset and broad-market shocks against representative historical periods.
- [ ] Verify exposure caps, concurrent-position limits, and drawdown blocks under stress.
- [ ] Add correlation-regime and recovery-path scenarios before strategy validation is considered complete.
