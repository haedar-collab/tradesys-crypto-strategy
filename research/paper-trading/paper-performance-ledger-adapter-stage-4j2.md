# Stage 4J.2 — Persistent Ledger Analytics Adapter

## Contract
The adapter accepts only a persistent ledger snapshot with status COMPLETE and consistent event count, sequence, event IDs, timestamps, and payload objects. The ledger implementation verifies JSONL integrity and SHA-256 hash-chain consistency when creating the snapshot.

## Data mapping
- ORDER_FILLED events are passed to the analytics engine for realized SELL execution statistics and recorded fill fees.
- POSITION_MARKED events supply timestamped equity marks for maximum drawdown.
- No quote, equity, or missing mark is synthesized by the adapter.

## Status
- COMPLETE: one or more valid durable equity marks are present.
- INCOMPLETE_EQUITY_HISTORY: ledger is valid but no durable equity marks exist. The report is explicitly incomplete for drawdown coverage.

## Accounting caveats
The broker's realized SELL PnL already includes exit fees and its average cost includes entry fees. Therefore the report exposes total recorded fees separately and does not subtract them again from realized PnL. Partial exits remain separate SELL executions.

## Not yet production-ready
The adapter is read-only. It does not add periodic mark scheduling, risk monitor persistence, or atomic coordination between order submission and risk checks. Those remain separate integration gates.
