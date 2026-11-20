# Marked Equity Curve — Integration Preparation

Added a pure snapshot builder and a marked-drawdown admission gate.

## API

- `buildEquitySnapshot(...)`: combines realized equity with open-position net contribution, reserves estimated liquidation fee/slippage, and updates the high-water mark.
- `markedDrawdownGate(snapshot, limitPct)`: blocks new entries when marked drawdown is at or above the configured threshold.

## Critical integration contract

Call the snapshot builder once per synchronized closed bar, after processing all exits for that bar and before evaluating new entries. Portfolio marks must use each asset's close from the same timestamp. Missing marks must fail closed; do not silently substitute stale prices.

## Current limitation

This commit adds tested primitives only. The existing single-symbol and portfolio simulators are not yet wired to this snapshot builder. Their current headline drawdown remains realized-equity based until that integration is completed and verified with end-to-end tests.
