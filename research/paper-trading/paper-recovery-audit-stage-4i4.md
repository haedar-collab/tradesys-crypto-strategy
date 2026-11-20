# Stage 4I.4 — Operational Recovery and Audit

## Delivered scope
- Added a read-only recovery audit in `src/paper/paper-recovery-audit.js`.
- The audit requires a complete ledger snapshot (the snapshot is produced by the persistent ledger, which verifies JSONL framing, sequence, unique event IDs, previous-hash links, and SHA-256 checksums when opening and snapshotting).
- Checks write-ahead order intents for missing terminal outcomes, conflicting/duplicate lifecycle events, fill records without intents, and invalid identifiers.
- Reconciles durable ledger fills against reconstructed paper broker orders, including symbol, side, quantity, fill price, gross notional, and fee.
- Recomputes expected cash and spot position quantities from initial cash and durable fills; compares them with the broker snapshot.
- Checks for a persisted risk-state event and validates the latest risk-state shape.
- Produces deterministic findings with severity, reference, and manual action. It never changes files, broker state, positions, cash, risk state, or lock files.

## Audit status
- `PASS`: no findings.
- `REVIEW`: unresolved write-ahead intent(s) or other non-critical error(s); operator investigation required.
- `FAIL`: critical integrity or reconciliation mismatch; do not activate the session.

## Stale lock recovery — manual-only procedure
1. Stop the application and all worker processes that could access the exact ledger path.
2. Confirm operationally that no process or host is still writing to that ledger. Do not rely on PID alone; PID reuse and host boundaries make it insufficient proof.
3. Record the exact absolute ledger path and inspect the adjacent `.lock` file metadata. Preserve a copy of both the ledger and lock for incident review.
4. If ownership cannot be conclusively ruled out, do not remove the lock. Escalate for operator review.
5. Only after confirming no writer exists, remove the stale `.lock` file manually under the operator's change-control procedure.
6. Re-open the ledger through the hash-chain verifier. If opening fails, stop; do not truncate, edit, or reconstruct records by guesswork.
7. Rebuild the paper broker from durable fills, run the recovery audit, and require a `PASS` before normal paper-session use. A `REVIEW` requires explicit human resolution; a `FAIL` blocks activation.

## Important limitations
- The audit is a diagnostic function, not an activation interlock. The caller must enforce that only `PASS` permits routine paper-session activation. This stage does not yet integrate automatic audit gating into session creation.
- Broker reconciliation is against the deterministic in-memory paper broker reconstructed from durable ledger fills, not Binance account balances or exchange execution reports.
- The current paper broker replay validates reproducibility, not external execution truth. An intent without a durable fill remains ambiguous and is never auto-replayed.
- Cash reconciliation assumes the same configured `initialCash` used to create the original session and the broker's current fee/fill model. Configuration provenance is not yet persisted as an immutable session header.
- No automatic stale-lock deletion, ledger repair, order replay, or balance adjustment is provided.
- Paper-only; no Binance order endpoint or live-trading authorization.
