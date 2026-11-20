# Stage 4I.4 — Operational Recovery and Audit

## Delivered scope
- Integrated the audit as a fail-closed activation gate in `createPersistentPaperSession`: only `PASS` returns an active session; `REVIEW` and `FAIL` throw an error carrying the structured `recoveryAudit` report.
- New sessions persist an immutable `SESSION_STARTED` header with mode, initial cash, fee/slippage, quote-age, and risk-limit configuration. Reopening with changed configuration is rejected.
- A recovered interrupted write-ahead intent is not executed; it is durably marked rejected for recovery bookkeeping, then the audit returns `REVIEW` and prevents activation until operator review.
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


## Stage 4I.6 — Legacy ledger migration utility
- Added `src/paper/legacy-paper-ledger-migration.js` for offline, copy-forward migration of verified pre-header ledgers.
- The source ledger is protected by an exclusive migration lock while it is read and remains byte-for-byte unchanged. The destination must be a different, non-existing path; creation uses no-overwrite semantics.
- Migration requires the complete original `PAPER_ONLY` configuration as explicit operator input. It does not infer initial cash, fee, slippage, quote-age, or risk limits.
- The migration header records the source SHA-256, source event count, format version, and migration timestamp. All legacy events retain their event IDs, types, timestamps, and payloads while being re-sequenced and re-hashed into the new chain.
- Corrupt, truncated, unsupported, already-migrated, or locked source ledgers are rejected. A destination collision is never overwritten.
- The migrated copy must still pass normal session recovery audit. A structurally valid migration is not proof that historical configuration or external execution truth has been established.

## Operator migration procedure
1. Stop the paper application and confirm all writers are stopped.
2. Preserve the original ledger and its lock metadata in a separate backup location.
3. Identify the exact historical session configuration from reliable records. If any value is unknown, stop; do not guess.
4. Run the migration utility with the original source path, a new destination path, and the complete explicit configuration.
5. Verify the returned source SHA-256 against the preserved original and inspect the migration metadata in the new first event.
6. Open the migrated copy with the normal session initializer. If recovery returns `REVIEW` or `FAIL`, do not activate it; investigate separately.
7. Keep the original ledger read-only until the migrated copy has been independently reviewed.

## Migration limitations
- This utility is not an automatic upgrade path and does not repair old event payloads.
- It does not establish external exchange fills, reconstruct missing risk history, or decide whether an ambiguous order was executed.
- The migration creates a new hash chain; its source hash binds the copy to the exact original bytes but does not certify that original data was truthful.
- No migration operation writes to or deletes the source ledger.

## Stale lock recovery — manual-only procedure
1. Stop the application and all worker processes that could access the exact ledger path.
2. Confirm operationally that no process or host is still writing to that ledger. Do not rely on PID alone; PID reuse and host boundaries make it insufficient proof.
3. Record the exact absolute ledger path and inspect the adjacent `.lock` file metadata. Preserve a copy of both the ledger and lock for incident review.
4. If ownership cannot be conclusively ruled out, do not remove the lock. Escalate for operator review.
5. Only after confirming no writer exists, remove the stale `.lock` file manually under the operator's change-control procedure.
6. Re-open the ledger through the hash-chain verifier. If opening fails, stop; do not truncate, edit, or reconstruct records by guesswork.
7. Rebuild the paper broker from durable fills, run the recovery audit, and require a `PASS` before normal paper-session use. A `REVIEW` requires explicit human resolution; a `FAIL` blocks activation.

## Important limitations
- Legacy ledgers created before the immutable `SESSION_STARTED` header are rejected by the activation gate. There is no automatic migration; preserve a backup and perform a separately reviewed migration process before using those ledgers again.
- The audit gate verifies the reconstructed paper broker and local ledger, not external execution truth.
- Broker reconciliation is against the deterministic in-memory paper broker reconstructed from durable ledger fills, not Binance account balances or exchange execution reports.
- The current paper broker replay validates reproducibility, not external execution truth. An intent without a durable fill remains ambiguous and is never auto-replayed.
- Cash reconciliation assumes the same configured `initialCash` used to create the original session and the broker's current fee/fill model. Configuration provenance is not yet persisted as an immutable session header.
- No automatic stale-lock deletion, ledger repair, order replay, or balance adjustment is provided.
- Paper-only; no Binance order endpoint or live-trading authorization.
