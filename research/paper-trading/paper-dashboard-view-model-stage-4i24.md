# Stage 4I.24 — Read-only Paper Dashboard View Model

## Objective
Provide a stable, UI-framework-neutral read model for a future dashboard. The repository has no browser application shell or UI framework; this stage deliberately adds a projection contract rather than inventing a frontend stack or adding dependencies.

## Files
- `src/paper/paper-dashboard-view-model.js`
- `tests/paper-dashboard-view-model.test.js`

## Contract
`buildPaperDashboardViewModel({...})` accepts immutable snapshots only:
- market feed status and last quote
- latest strategy signal and acceptance decision
- persistent ledger snapshot and derived performance report
- risk monitor status
- current position marks

It returns a frozen view model with explicit `PAPER_ONLY` mode and permissions:
`readOnly=true`, `maySubmitOrders=false`, `mayMutateLedger=false`, `mayResetRisk=false`.

## Fail-closed display rules
- Disconnected feed, invalid/future quote, or stale quote does not expose bid/ask.
- Analytics are shown only when both the ledger snapshot and report are complete and consistent.
- Drawdown is withheld if there are no durable equity marks.
- Missing position marks remain null and are flagged as UNMARKED; no price or PnL is estimated.
- A latched kill switch takes precedence over an otherwise nominal ALLOWED status.
- Missing risk state is UNKNOWN, not ALLOWED.
- Acceptance is informational only; the view model has no execution dependency or mutation capability.

## Validation
The test suite covers read-only permissions, feed states, stale/future/invalid quotes, acceptance display, incomplete ledger/analytics, risk latch, unmarked positions, immutability, and invalid input.

Run: `npm test`.

## Limitations / next step
This is not a rendered web dashboard. No UI framework or application entry point exists in this repository. A frontend can consume this contract after the main application shell is identified and wired to actual runtime snapshots. The live Binance smoke test remains a separate manual network verification and is not implied by these deterministic unit tests.
