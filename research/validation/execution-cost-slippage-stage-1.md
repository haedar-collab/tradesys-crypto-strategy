# Execution Cost & Slippage Sensitivity — Stage 1

## Purpose

The event-driven and portfolio simulators already apply configurable per-side fees and adverse slippage to entries, exit tranches, and estimated liquidation marks. This stage adds a repeatable scenario matrix so a strategy is not evaluated only under one optimistic cost assumption.

## Implementation

- `src/backtest/cost-sensitivity.js` runs the same input through a supplied simulator over a fee/slippage matrix.
- Defaults are fee assumptions of 0, 5, 10, and 20 bps per side and adverse slippage assumptions of 0, 5, 10, 20, and 50 bps.
- The runner reports net return, ending equity, drawdown, profit factor, closed-trade fees, gross/net PnL, skipped signals, and whether exposure remains open.
- The runner is compatible with both `runEventBacktest` and `runPortfolioBacktest`.
- Each scenario receives a fresh shallow copy of the input object; nested market-data arrays are treated as immutable by the simulator.

## Interpretation rules

1. These are sensitivity assumptions, not a statement of the user's Binance fee tier.
2. Fee and slippage values must be calibrated to the account's actual fee schedule, order type, pair liquidity, trade size, and observed fills.
3. A strategy that is profitable only at zero or near-zero costs is not robust enough to advance.
4. This matrix does not model order-book depth, queue priority, partial fills, latency, market impact, spread dynamics, or exchange outages.
5. The existing OHLC simulator uses conservative stop-first handling when a candle touches both stop and target. It is not an exchange fill model.
6. Terminal open-position values remain estimated mark-to-market values including estimated liquidation costs; explicit forced terminal liquidation is a separate validation item.

## Validation

Run `npm test` with Node.js 20 or later.

The new tests verify matrix completeness, baseline immutability, non-improving returns under higher adverse slippage for a fixed closed-trade fixture, and fail-closed input/result validation.

## Exit criteria for this stage

- [ ] New unit tests pass in local or GitHub Actions CI.
- [ ] Both single-symbol and portfolio simulators are exercised through the scenario runner.
- [ ] Results are reviewed using realistic account fee assumptions and multiple slippage bands.
- [ ] No claim of live execution accuracy is made from OHLC-only simulation.
