# Stage 4I.12 — Paper Trading Long-Duration Reliability & Stress Testing

## Scope

This stage adds deterministic stress coverage for long-running PAPER_ONLY sessions. It tests persistence, repeated recovery, ledger-backed analytics, and risk-stop behavior. It does not connect to Binance, submit live orders, enable automation, or claim strategy profitability.

## Long-duration scenario

- Run 64 sequential BTCUSDT round trips (64 BUY fills and 64 SELL fills).
- Each round trip includes a durable mark-to-market event.
- Advance the injected UTC clock by six hours after each cycle, spanning multiple UTC dates.
- Close and reopen the same persistent ledger after every eight cycles: seven restart boundaries.
- Require recovery audit PASS and flat broker inventory after each restart.
- At completion, verify 128 durable fills, 64 position marks, complete analytics, positive fee accounting, finite realized PnL and drawdown metrics, and PAPER_ONLY mode.

## Risk-stop scenario

- Open one small paper position.
- Persist a fresh position mark while the position is open, then latch the kill switch manually. The mark is required by the entry risk gate to evaluate portfolio risk; without it, the test would only exercise the fail-closed RISK_DATA_UNAVAILABLE path.
- Verify a subsequent BUY entry is rejected specifically by the latched kill switch.
- Verify SELL remains permitted to exit the already-open position.
- Verify the position is flat while the kill switch remains latched and the recovery audit passes.

## Interpretation and limits

The fixtures are deterministic software tests, not a simulation of realistic market microstructure. Six-hour clock increments test date rollover and persistence sequencing; they do not model elapsed compute time, network latency, exchange outages, order-book depth, partial fills, or market impact.

The 64-cycle test does not establish statistical strategy edge or expected returns. Any realized PnL is a by-product of fixed test quotes and must not be treated as a performance forecast.

The stress coverage is bounded to one local process and a local filesystem. It does not establish multi-host locking, cloud-storage durability, production throughput, or external account reconciliation. Existing fail-closed behavior remains: no automatic order replay after ambiguous submission, no stale-lock deletion, no in-place ledger repair, and no forced liquidation.

## Acceptance criteria

- 64 round trips complete with 128 durable fills and 64 durable position marks.
- Seven restart boundaries recover with audit PASS and no open inventory.
- Final ledger-backed analytics are COMPLETE and contain finite metrics.
- Kill switch blocks new BUY entries but permits SELL exit of an existing paper position.
- Final session remains PAPER_ONLY.
- No external credentials, paid services, exchange connectivity, or live orders are used.

## Run

`npm test`

All scenarios use temporary local files and an injected clock.
