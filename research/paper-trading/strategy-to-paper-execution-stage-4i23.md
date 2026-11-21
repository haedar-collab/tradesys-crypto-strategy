# Stage 4I.23 — Strategy Acceptance to Paper Execution Gate

## Objective

Connect the existing evidence-based strategy acceptance engine to the persistent paper session so a BUY signal cannot enter the paper broker merely by supplying a caller-created `{ decision: "ACCEPT" }` object.

## Implementation

- `src/paper/strategy-paper-execution.js`
- `tests/strategy-paper-execution.test.js`

The adapter:
1. Accepts a strategy evidence report and BUY signal.
2. Calls `evaluateStrategyAcceptance` internally.
3. Returns `BLOCKED` for CONDITIONAL or REJECT, before writing an `ORDER_SUBMITTED` event.
4. For ACCEPT only, submits the BUY to the persistent paper session.
5. Preserves the quote from the upstream market-data adapter so provenance enforcement remains active.
6. Leaves portfolio risk checks, ledger persistence, and broker fill rules inside the persistent paper session.

## Test cases

- Incomplete evidence is CONDITIONAL and creates no paper order intent.
- Hard-threshold failure is REJECT and creates no paper order intent.
- Complete accepted evidence reaches the paper session and produces a durable paper fill when the quote and risk gates pass.

## Safety boundary

This adapter accepts BUY entries only. Existing session exit behavior remains separate. This is not a live execution adapter and does not send orders to Binance.

The acceptance report is supplied by the caller; this adapter verifies it against the acceptance engine's thresholds but does not independently regenerate the backtest, walk-forward, regime, cost-stress, or bootstrap evidence. Therefore report provenance and immutable experiment artifacts still require an operational evidence chain before any stronger release claim.

## Acceptance

Stage 4I.23 is accepted only as a controlled strategy-to-paper integration gate. It does not establish strategy profitability or authorization for live trading.
