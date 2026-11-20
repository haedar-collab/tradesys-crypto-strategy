# Stage 3M — Live Binance Strategy Replay

A strategy-side workflow downloads current public Binance Spot klines for BTCUSDT (or a manually selected symbol), validates at least 210 contiguous closed candles for Weekly, Daily, 4H and 1H, constructs the v1 transport shape and invokes the existing causal historical MTF replay.

The run emits a JSON report with candle counts and one current evaluation decision. It does not place orders.

Important boundary:
- This validates live-data ingestion into the strategy replay and the consumer's v1 payload shape.
- The application repository separately runs its own producer pipeline and publishes the full v1 payload artifact.
- This workflow re-creates the same transport shape from Binance rather than downloading the private artifact from the application repository; therefore it is not a byte-for-byte cross-repository artifact handoff.
- One current evaluation is not walk-forward backtesting and says nothing about profitability.
- Fees, slippage, fill simulation and portfolio-level risk are not included.
