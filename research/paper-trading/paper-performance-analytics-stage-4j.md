# Stage 4J — Paper Trading Performance Analytics

## Scope
Deterministic, read-only analytics over paper-ledger events. No exchange connectivity and no order execution.

## Metrics
- Closed-trade count, wins, losses and win rate.
- Gross profit, gross loss, profit factor, net realized PnL and expectancy.
- Total recorded fill fees.
- Daily, ISO-week (UTC Monday start), and monthly realized PnL buckets.
- Maximum drawdown from supplied timestamped equity marks.

## Accounting rules
- Only SELL fills contribute closed-trade realized PnL because the current broker records realized PnL on exits.
- Partial SELL executions count as separate realized executions; they are not reconstructed into round-trip positions.
- Fees are summed across all BUY and SELL fills. Do not subtract them again from realized PnL: broker realized PnL already includes exit fees and average cost includes entry fees.
- Profit factor is null when gross loss is zero or no losses exist; it is not reported as infinity.
- Ratios are null when their denominator/sample is unavailable.
- Open-position unrealized PnL is excluded from realized return and expectancy.

## Drawdown
Maximum drawdown uses supplied equity snapshots, sorted by timestamp, with initial equity as the starting peak. No synthetic marks or interpolation are introduced. Missing snapshots mean drawdown coverage is incomplete.

## Limitations / next integration gate
- Connect POSITION_MARKED ledger events to the analytics input through a validated adapter.
- Ensure marks are generated on a consistent cadence and include open-position valuation.
- Persist and restore the risk monitor state before treating daily/weekly reports as operational.
- Add end-to-end tests from persistent session -> ledger -> analytics.
- This module is not a statement of profitability and does not authorize live trading.
