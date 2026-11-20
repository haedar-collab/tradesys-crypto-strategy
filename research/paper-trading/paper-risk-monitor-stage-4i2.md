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
