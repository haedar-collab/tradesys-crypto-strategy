# Stage 4I.11 — Paper Trading Operational Readiness & Extended Simulation

## Scope

This stage adds an integration simulation for the existing paper-only session stack. It does not add exchange connectivity, live orders, auto-trading, or a profitability claim.

## Scenario exercised

- Start a persistent session with an immutable PAPER_ONLY configuration.
- Execute 12 sequential BUY/mark-to-market/SELL cycles using deterministic, timestamped bid/ask quotes.
- Advance the simulation clock across multiple UTC dates.
- Close and reopen the same ledger after each group of four cycles.
- Require recovery audit PASS after each restart.
- Verify broker inventory is restored and flat after completed round trips.
- Generate performance analytics only from the final durable ledger snapshot.
- Verify an independently opened session is rejected while the ledger lock is held.

## Acceptance criteria

- All 24 order executions are durable and reconstruct to the paper broker.
- Each cycle has a durable POSITION_MARKED event.
- Three restart boundaries recover with audit PASS.
- Final broker inventory is flat and cash reconciliation passes.
- Analytics report 12 realized SELL executions and 12 equity marks.
- Fee totals and realized PnL are derived from recorded fills, not fabricated inputs.
- Concurrent ledger opening fails closed.
- Session mode remains PAPER_ONLY throughout.

## Interpretation

A passing deterministic simulation establishes integration behavior for the tested scenario and runtime. It is not a statistical backtest, market replay across historical regimes, proof of strategy edge, or production load test.

The paper broker models top-of-book execution plus fixed slippage and fees. It does not model queue priority, partial fills, order-book depth, latency, market impact, exchange outages, or Binance account reconciliation.

The simulation's positive realized PnL is a fixture outcome produced by intentionally favorable deterministic quotes. It must not be interpreted as expected return or evidence of profitability.

## Operational readiness status

- Local ledger integrity and recovery: covered by prior 4I stages.
- Repeated restart integration: exercised by this simulation.
- Ledger-backed performance report: exercised by this simulation.
- External execution reconciliation: not implemented.
- Live trading and production authorization: out of scope and not approved.

## Run

`npm test`

The test is deterministic and uses temporary local files only. It does not require API credentials or external paid services.

## Replay hardening discovered by the simulation

The restart scenario exposed a real integration defect: a BUY was executed by the broker using the persistent session's internally authorized risk-gate input, but the ledger previously retained only the caller's original order input. On restart, deterministic broker replay therefore lacked the trusted execution authorization and failed closed.

The fill event now preserves both:
- `orderInput`: the original caller request, retained for idempotency and audit context.
- `executionInput`: the exact internally authorized input used by the paper broker.

Recovery replays `executionInput` when present and falls back to `orderInput` for older ledger entries. This is a paper-broker replay detail; it does not grant an external caller the ability to bypass the persistent risk gate. The extended restart simulation covers the regression.

Latest validation after this fix: 316 tests passed, 0 failed in CI run 44838023048.
