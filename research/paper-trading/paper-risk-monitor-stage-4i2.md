# Stage 4I.2 — Persistent Paper Risk Gate Integration

## Integrated behavior
- The persistent paper session owns a risk monitor; caller-supplied `riskGate: { allowed: true }` is never sufficient to authorize a BUY.
- A caller-supplied explicit veto (`riskGate.allowed === false`) remains a veto.
- BUY entries are checked against projected marked exposure, projected equity, the UTC daily-loss baseline, and peak-equity drawdown.
- SELL exits remain permitted while the kill switch is latched. The kill switch blocks new entries; it does not liquidate positions.
- Every mark-to-market operation also evaluates the risk monitor.
- Risk state and audit events are written as `RISK_EVENT` records in the hash-chained persistent ledger.
- Restart restores the latest persisted risk-monitor state, including the latched kill switch.
- New sessions persist an initial-equity baseline before the first order.
- Order submissions are serialized within a session to avoid concurrent in-process risk-check races.
- The persistent ledger uses an exclusive lock file held for the lifetime of the session; lock ownership is checked before release.
- Initialization failures release the lock. Stale lock recovery is intentionally manual to avoid stealing a lock from a slow but active writer.

## Fail-closed conditions
- If an open position has no durable, fresh mark, or a mark predates the most recent fill, new BUY entries are rejected.
- If the projected portfolio would exceed a hard risk threshold, the entry is rejected and the kill switch is latched.
- A write-ahead order intent without a durable fill is ambiguous after a crash. Recovery records a rejection requiring manual review; it does not silently replay the order.
- Explicit reset requires a fresh portfolio snapshot and all hard limits to be clear.

## Defaults
- Daily loss limit: 3% of UTC day-start equity.
- Maximum drawdown: 10% from peak equity.
- Maximum gross marked exposure: 80% of current equity.
- Maximum age of a durable mark for new-entry risk checks: 60 seconds by default (configurable).

## Remaining limitations
- The ledger acquires an exclusive lifetime lock (`.lock`) so a second process cannot open the same ledger concurrently. A pre-existing lock is treated as stale/owned by another process and is never auto-deleted; operator review is required.
- It does not liquidate existing positions or manage protective exits.
- Mark freshness is only as reliable as the timestamp supplied by the caller; production integration must source marks from the trusted market-data adapter.
- This stage is not live-trading authorization and does not connect to Binance order endpoints.


## Stage 4I.3 — Reliability and concurrency hardening
- An exclusive `.lock` file is created with atomic `open(..., "wx")` and retained for the ledger lifetime.
- A second independent Node.js process is tested and must fail to open the same ledger while the first process owns the lock.
- Graceful close releases the lock. Abrupt process termination intentionally leaves a stale lock; automatic lock stealing is disabled and manual operator review is required.
- Initialization/recovery failures release a lock acquired by the current process.
- Recovery rejects a JSONL file whose final record is not newline-terminated; it never appends to an ambiguous partial tail.
- Crash-window recovery is tested for a durable order intent alone and for an order intent followed by a durable risk-check snapshot but no durable fill. Both are rejected for manual review and are never auto-executed.
- A durable `ORDER_FILLED` event is replayed to reconstruct paper broker balances and positions; the existing restart test verifies this path.

### Scope and operational caveats
- The lock is intended for processes sharing a local filesystem with reliable exclusive-create semantics. It is not a distributed lock service and does not establish safe coordination across arbitrary network filesystems or hosts.
- Stale lock cleanup must only be performed after the operator verifies that no process still owns the ledger.
- Abrupt termination between an in-memory broker fill and durable `ORDER_FILLED` is fundamentally ambiguous with the current paper broker. Recovery fails closed from the durable write-ahead intent; it cannot prove whether an external broker filled an order. This remains a paper-only simulation and is not an exchange execution protocol.
