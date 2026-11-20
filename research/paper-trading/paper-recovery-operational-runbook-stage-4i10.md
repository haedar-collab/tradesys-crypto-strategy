# Stage 4I.10 — Recovery Operational Runbook & Readiness Assessment

## Purpose

This runbook defines a conservative operator workflow for local paper-ledger inspection, backup verification, recovery, and escalation. It does not authorize live trading, automatic replay, automatic ledger repair, or exchange reconciliation.

## Operating invariants

- The strategy remains `PAPER_ONLY`; no live order execution is supported by this stage.
- Preserve the original ledger and all incident evidence. Never edit a ledger in place to make an audit pass.
- A lock file is not proof that its process is dead. Never delete or steal a lock until the operator independently confirms that no process owns the ledger.
- Do not replay an ambiguous `ORDER_SUBMITTED` intent. The durable local ledger cannot establish whether an external venue filled it.
- A clean local audit is not proof of Binance account state, exchange fills, or real-world execution truth.
- Restore or migrate to a new destination path. Do not overwrite the source.

## Operator procedure

### 1. Stop writers and preserve evidence

1. Stop the paper session through its supported shutdown path where possible.
2. Record the host, process/service identity, UTC time, operator, and incident reason.
3. Preserve the ledger, its `.lock` file if present, application logs, and relevant market-data inputs.
4. Do not run two session processes against the same ledger path.

### 2. Inspect the ledger (read-only)

Call `inspectPaperLedgerFile({ filePath })`.

Interpretation:
- `HEADERED_LEDGER`: a session header exists; this is only structural preflight, not activation approval.
- `LEGACY_LEDGER`: no session header; evaluate the explicit legacy migration process.
- `LOCKED_OR_STALE`: stop. Identify whether a live process owns the lock. If ownership cannot be established, preserve the lock and escalate.
- A corrupt or truncated hash chain is a hard stop. Preserve the original bytes for forensic review.

Preflight does not repair or mutate the ledger.

### 3. Create and verify a backup

1. Copy the ledger to a separate, access-controlled destination while the writer is stopped.
2. Keep the source and backup on appropriately protected storage; record who made the copy and when.
3. Call `verifyPaperLedgerBackup({ sourcePath, backupPath })`.
4. Continue only when status is `PASS`, `byteIdentical` is true, both ledgers validate, and neither path has a lock.
5. `REVIEW` means a lock was detected; do not treat the copy as a stable backup until process ownership and quiescence are established.
6. `MISMATCH` or `INVALID` means stop and preserve both files. Do not overwrite either file to force a match.

The verifier checks stable reads, SHA-256 byte identity, and each local hash chain. It is not a storage durability guarantee and does not validate exchange-side executions.

### 4. Legacy migration (only when required)

1. Confirm the source is unlocked and its hash chain verifies.
2. Supply every required historical paper configuration value explicitly. Do not infer missing fee, slippage, quote-age, or risk limits.
3. Run `dryRunLegacyPaperLedgerMigration` and retain the report.
4. Migrate only to a new, non-existing destination path. The migration routine rechecks source conditions under its exclusive lock.
5. Keep the source unchanged and retain its SHA-256 and migration report.
6. Run normal recovery audit on the migrated destination. A migration result alone is not activation approval.

### 5. Recovery activation

1. Use the normal session creation/activation path; activation performs its recovery audit.
2. Only `PASS` may activate. `REVIEW` and `FAIL` are stop conditions.
3. Export the audit report to a new path using the no-overwrite report exporter.
4. Do not reset risk state, fabricate equity marks, invent fills, or bypass an activation finding.
5. If an interrupted order intent exists, keep the session blocked for manual review. Do not infer whether the exchange filled it.

### 6. Stale lock handling

A stale lock is a manual incident, not a cleanup task:
- Confirm the service is stopped and identify the PID/host associated with the lock.
- Verify no process is still writing to the ledger.
- Preserve a copy of the lock contents and incident logs.
- Follow the deployment's approved operational procedure to resolve the lock only after ownership is conclusively ruled out.
- If the process/host cannot be verified, do not remove the lock; escalate.

The repository intentionally does not implement automatic stale-lock deletion.

## Readiness assessment

| Area | Readiness | Evidence / limitation |
|---|---|---|
| Hash-chain integrity | Implemented | Ledger verification detects malformed JSON, sequence/link errors, duplicate IDs, checksum mismatch, and incomplete final records. |
| Single-process writer exclusion | Implemented with limits | Exclusive local lock; not a distributed lock service and not guaranteed across arbitrary network filesystems or hosts. |
| Recovery audit and activation gate | Implemented | Only PASS activates; REVIEW/FAIL block. Audit covers local ledger and paper broker state only. |
| Legacy migration | Implemented | Copy-forward to new path with explicit config; source preserved; no automatic repair. |
| Recovery preflight/reporting | Implemented | Read-only inspect, dry-run, deterministic report formatting, no-overwrite export. |
| Backup integrity verification | Implemented | Stable-read check, SHA-256 byte equality, both ledger hash chains, lock detection. |
| Fault/recovery drills | Automated tests | Deterministic integration/fault-state tests; not proof against every kernel crash, power loss, filesystem, or storage-controller failure. |
| Exchange execution reconciliation | Not implemented | No proof of external fills, balances, or account positions. |
| Live trading / auto execution | Out of scope | Paper-only; no live order execution. |

## Go / no-go criteria

**GO for local paper-session recovery only** when all of the following hold:
- no unexplained lock is present;
- source and backup are preserved and backup verification is `PASS`;
- ledger integrity checks pass;
- recovery audit is `PASS`;
- session configuration matches its immutable header;
- fresh, durable marks exist where required by risk controls;
- operator records the recovery decision and report.

**NO-GO** for any lock with uncertain ownership, hash-chain error, backup mismatch, recovery status REVIEW/FAIL, ambiguous order intent, missing required marks, configuration mismatch, or unresolved external execution uncertainty.

Even a GO decision here means only local paper-session readiness. It does not mean production readiness, exchange reconciliation, or authorization to trade real funds.

## Escalation

Escalate to the system owner when:
- an order may have been sent externally but no durable local fill outcome exists;
- a ledger or backup hash differs;
- lock ownership cannot be established;
- recovery audit findings cannot be resolved from preserved evidence;
- filesystem behavior differs from the assumptions of local exclusive-create and hard-link publication.

Record the exact ledger/backup SHA-256 values, paths, UTC timestamps, process/host details, audit report, and actions taken. Never include API keys, secrets, or credentials in the report.

## Verification scope

This stage adds a read-only backup verifier and automated tests for matching copies, corrupted/mismatched copies, lock review, same-path rejection, and missing files. CI results must be checked before marking this stage complete.
