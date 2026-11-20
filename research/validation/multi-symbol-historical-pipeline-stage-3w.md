# Stage 3W — Multi-Symbol Historical Data Pipeline

## Scope
Sequential orchestration for the initial five-symbol research universe (BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT) across 1h, 4h, 1d, and 1w. The default request matrix is 20 datasets.

## Controls
- Sequential acquisition to avoid uncontrolled request bursts.
- Validate OHLC structure, duplicate timestamps, ordering, and missing intervals before persistence.
- Persist only datasets with quality status COMPLETE.
- Continue after an individual dataset failure and record the failure in the manifest.
- Compare exact timestamp alignment across symbols per interval.
- Emit a manifest with source, requested range, counts, quality findings, and storage receipt.

## Storage contract
The pipeline accepts an injected writeDataset callback. No implicit filesystem or cloud storage is selected. The caller must supply a durable writer and retain returned storage receipts. Tests use an in-memory writer.

## Acceptance and limitations
The pipeline reports COMPLETE only if every requested dataset passes quality checks and each interval's valid datasets align. It does not prove full requested-range coverage by itself: expected candle schedule and boundary semantics must be checked against the chosen date range. It does not execute a live download during CI, and it does not implement retry/backoff or scheduling.
