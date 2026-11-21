# Stage 4I.13 — Multi-Symbol Portfolio Stress & Risk Reconciliation

## Objective

Validate the existing persistent paper session across multiple simultaneous spot positions. This stage adds regression coverage only; it does not change production behavior or introduce new strategy indicators.

## Scope

- Three concurrent spot positions: BTCUSDT, ETHUSDT, and SOLUSDT.
- Durable mark-to-market snapshots containing every held symbol.
- Fresh-mark requirement before adding another position or increasing exposure.
- Fail-closed behavior when the latest portfolio mark exceeds the configured age.
- Aggregate portfolio exposure gate at an 80% limit.
- Latched kill switch after a hard exposure breach.
- SELL exits remain available while the kill switch is latched.
- Ledger/broker reconciliation after a restart with multiple open positions.
- Ledger-derived performance analytics after all positions are closed.

## Test scenario

The test creates three positions with a combined notional below the 80% exposure ceiling. It persists a complete mark for the held portfolio after each entry, then closes and reopens the session. Recovery must return PASS and restore all three positions.

After restart, an entry using a fresh market quote but a stale portfolio-risk mark must be rejected with `RISK_DATA_UNAVAILABLE`. A new complete mark for all held assets restores risk-data eligibility. A further BTCUSDT entry that pushes aggregate exposure beyond 80% must be rejected with `MAX_EXPOSURE_LIMIT_EXCEEDED` and latch the kill switch. SELL orders for all three existing positions must still fill. The final broker inventory must be flat and the recovery audit must remain PASS.

## Verification

- GitHub Actions run: `44847326314` — SUCCESS.
- Test suite: 319 passed, 0 failed.
- New scenario: `multi-symbol portfolio marks, aggregate exposure gate and recovery remain consistent` — PASS.
- The preceding run `44847279020` failed because the test attempted a second BUY without first persisting a fresh mark for the already-held asset. The fixture was corrected to mark every held symbol after each entry; no production-code defect was identified by that failure.

## Findings and limitations

- The risk gate evaluates aggregate marked exposure across the portfolio, not only the symbol being entered.
- Every held position must be represented by a fresh durable mark before a new BUY is eligible.
- This is deterministic local paper-broker testing. It does not establish exchange execution truth, real-world liquidity, market impact, profitability, or production readiness.
- No live order execution, automatic liquidation, stale-lock cleanup, or ledger repair was added.
- The strategy repository remains separate on `feature/app-data-contract-v1`; no merge to the main repository was performed.

## Next engineering priority

The next meaningful reliability gap is quote and mark provenance: the current paper session validates the quote shape and age supplied by its caller, but it does not independently prove that the price came from an authenticated or trusted Binance market-data stream. Before any live-trading discussion, the system needs an explicit market-data provenance contract and stale/disconnected-feed handling while retaining signal-only operation.
