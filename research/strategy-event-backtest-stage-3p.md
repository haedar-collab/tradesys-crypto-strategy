# Stage 3P — Strategy-to-Execution Backtest Bridge

This adapter connects the causal historical MTF decision replay to the existing single-symbol event-driven Spot simulator.

For every candidate, the adapter requires an exact match between evaluationTime and H1 closeTime + 1 ms, then maps the candidate to that H1 bar index. The event-driven simulator enters no earlier than the next available H1 bar open. Candidates without a matching next bar or a complete numeric plan are excluded and explicitly reported.

The backtest remains long-only, single-position, signal-only research. Fees and adverse slippage are configurable assumptions. It is not a live order interface and does not claim exchange-realistic fills or profitability.

The live BTCUSDT sample currently has zero candidates, so the integrated backtest should correctly report zero executed trades. A zero-trade result is a valid outcome, not a reason to manufacture signals.
