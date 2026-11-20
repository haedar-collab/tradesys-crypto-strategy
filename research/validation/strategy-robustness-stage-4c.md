# Stage 4C — Strategy Robustness Suite

## Components

### Parameter sensitivity
One-factor-at-a-time perturbation of explicitly supplied nested numeric, boolean, or string parameters. Each scenario receives an isolated deep clone. The runner must return finite net return, ending equity, and maximum drawdown.

### Trade-sequence Monte Carlo
Bootstrap resampling with replacement over closed-trade net returns. Uses a seeded deterministic PRNG and reports ending-equity and net-return percentiles, drawdown percentiles, and probability of loss.

## Interpretation constraints
- Sensitivity results are conditional on the selected dataset and supplied runner; they are not optimization.
- Bootstrap Monte Carlo assumes independent, identically distributed trade returns. It does not model serial dependence, market-regime transitions, liquidity, market impact, or execution uncertainty.
- Use net returns after fees/slippage, sourced only from out-of-sample closed trades, to avoid optimistic estimates.
- Do not treat the 5th percentile as a guaranteed worst case.
- This module does not issue trading signals or orders.

## Tests
Covers isolated parameter scenarios, input immutability, invalid parameter paths, deterministic Monte Carlo output, and invalid configuration.

## Remaining work
Connect these diagnostics to actual out-of-sample walk-forward trades, add regime-segmented reporting, calibrate fee/slippage assumptions to the account and observed fills, and verify the full CI suite.
