# Stage 4H — Persistent Paper Session Integration

## Purpose
Connect the paper broker to the append-only ledger and make the ledger the durable source of truth for paper order intent and fills.

## Flow
1. Append ORDER_SUBMITTED (write-ahead intent) with the complete deterministic paper order input.
2. Execute through the paper-only broker.
3. Append ORDER_FILLED with the resulting fill and original input, or ORDER_REJECTED with the failure.
4. On startup, replay durable fills in ledger order to reconstruct cash and positions.
5. Complete any ORDER_SUBMITTED event that has no corresponding fill or rejection (crash recovery).
6. Persist mark-to-market observations as POSITION_MARKED.

## Safety
- No Binance API calls, credentials, live orders, leverage, or short selling.
- Strategy acceptance and portfolio risk gates remain mandatory.
- Replay uses the recorded quote and original order parameters; it is a deterministic simulation, not exchange reconciliation.
- The ledger is single-process only. Do not open the same ledger from multiple running processes.
- The broker is reconstructed from fills; mark-to-market observations are historical telemetry and do not mutate positions.

## Known limitations
- Recovery assumes deterministic broker configuration (initialCash, feeBps, slippageBps) is kept unchanged across restarts. These settings should be persisted and validated in the next hardening stage.
- This is a local paper-session engine, not production-grade database storage. Backup, disk-full handling, multi-process locking, and power-loss testing remain outstanding.
- A crash during a partial JSONL append currently causes integrity verification to fail closed; automated tail repair is not implemented.
- Rejected submissions are durable and idempotent by client order ID.

## Tests
Covers order persistence, restart reconstruction of cash and positions, cross-restart idempotency, recovery of write-ahead intents, durable rejections, and mark-to-market persistence.
