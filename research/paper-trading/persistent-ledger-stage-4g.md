# Stage 4G — Persistent Paper Trading Ledger

## Purpose
Provide durable append-only storage for paper-trading events, restart recovery, event idempotency, and integrity verification. The ledger records events supplied by the paper broker; it does not execute or reconcile exchange orders.

## Design
- JSON Lines append-only file.
- Every event has a unique eventId, UTC millisecond timestamp, monotonically increasing sequence, previousHash and SHA-256 hash.
- Appends are serialized within one process and fsynced before success is returned.
- On startup, the full file is replay-verified for sequence continuity, duplicate IDs, and hash-chain integrity.
- Repeating the same event ID with identical content is idempotent; different content is rejected.
- File permissions are created as owner read/write where supported.

## Supported event types
SESSION_STARTED, ORDER_SUBMITTED, ORDER_FILLED, ORDER_REJECTED, POSITION_MARKED, RISK_EVENT, SESSION_STOPPED.

## Important constraints
- This first implementation is single-process. Do not open the same ledger file concurrently from multiple processes.
- A hash chain detects accidental modification but is not tamper-proof against an attacker who can rewrite the entire file and recompute hashes. Use protected storage and backups.
- This ledger is not yet wired into createPaperBroker; integration and crash-consistency tests are a separate next step.
- It does not yet persist a broker state snapshot or provide external order reconciliation.
- Keep all records paper-only; no exchange credentials or live order endpoint is supported.

## Tests
Covers append and restart recovery, concurrent in-process appends, idempotency, event ID conflict, invalid event types/timestamps, and tamper detection.
