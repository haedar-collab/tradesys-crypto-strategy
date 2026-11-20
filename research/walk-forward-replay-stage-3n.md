# Stage 3N — Walk-Forward Historical Replay

The walk-forward driver derives evaluation timestamps from closed H1 candles (closeTime + 1 ms), then calls the existing causal MTF replay for each timestamp. The causal context builder independently filters each timeframe to candles whose closeTime is strictly less than that evaluation timestamp.

Defaults:
- 168 hourly evaluations (last seven days represented in available H1 history)
- 1-hour step
- 60 H1 bars warm-up minimum
- Existing MTF minimum bars and freshness checks remain in force

The report summarizes READY/WAIT/candidate counts and reason frequencies. This is decision replay, not a trade backtest: it does not simulate fills, positions, fees, slippage, exits, or portfolio returns. A later stage must connect decisions to the event-driven execution simulator and reserve a genuinely untouched out-of-sample period.
