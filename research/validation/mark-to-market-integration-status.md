# Mark-to-Market Accounting Foundation

This module adds independently tested accounting primitives for long-only Spot backtests.

- Remaining quantity is marked to the supplied close price.
- Entry fee and already-paid exit fees remain deducted.
- Realized PnL from partial exits is retained.
- Estimated liquidation slippage and exit fee are reserved on remaining quantity.
- Drawdown is computed from marked equity and a high-water mark.

## Integration status

These helpers are a foundation and are **not yet wired into** `event-driven.js` or `portfolio.js`. Until integration and end-to-end regression tests are complete, the existing backtest headline equity and drawdown outputs remain realized-only and must not be treated as corrected.
