# Stage 3N — Live Binance Walk-Forward Replay

This workflow fetches current public Binance Spot history for one symbol: 250 weekly, 250 daily, 250 4H and up to 1,000 H1 candles. It validates closed-candle continuity, then evaluates the strategy at hourly close boundaries over the most recent 168 available H1 hours.

The strategy context builder filters each timeframe to candles with closeTime strictly less than the evaluation timestamp and applies its existing timeframe freshness and warm-up rules.

The output reports READY/WAIT/candidate counts and reason frequencies. It is a rolling historical decision replay only. It does not simulate trades, fees, slippage, fills, stops, targets, or portfolio equity. The 168-hour window is not a statistically sufficient out-of-sample performance sample and must not be used to claim profitability.
