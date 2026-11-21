# Stage 4I.41 — Live Feed Evidence & Runtime Acceptance

## Purpose

Make the manual Binance Spot WebSocket smoke test produce a retained JSON evidence artifact and define deterministic acceptance rules. This is an operational network check, not a trading authorization.

## Evidence contents

The smoke script emits a JSON report containing the test identifier, UTC check time, exact requested symbol list, per-symbol bid/ask/spread, quote age, source, event-time basis, failures, and overall result. When `BINANCE_SMOKE_REPORT_PATH` is set, the same report is written to that path.

The manual GitHub Actions workflow retains the report as an artifact for 14 days, including failed runs when the report was produced.

## Acceptance rules

The evidence validator accepts only:
- The expected report identity and canonical UTC timestamp.
- Exactly BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, and XRPUSDT in the configured order.
- Exactly one passing result for every requested symbol and no failed symbols.
- Positive bid, ask greater than or equal to bid, and a mathematically consistent spread.
- Quote age from 0 through 10,000 ms.
- Source `BINANCE_SPOT_WS_BOOK_TICKER`.
- Event time basis explicitly identified as exchange event time or local receive time.

A report that fails any criterion is rejected. A report validator checks structure and consistency; it cannot authenticate who created a JSON file or prove that a network observation was not fabricated. The GitHub Actions run and its retained artifact provide operational traceability, not cryptographic attestation.

## Important timestamp limitation

Binance Spot `<symbol>@bookTicker` messages do not provide an exchange event timestamp. The feed adapter therefore sets event time to local receive time and labels it `LOCAL_RECEIVE_TIME`. This is not exchange-clock latency. If a payload later supplies an exchange event timestamp, it is labeled `EXCHANGE_EVENT_TIME`.

## Operator procedure

1. Open repository Actions.
2. Select **Binance Spot Live WebSocket Smoke**.
3. Select **Run workflow** on branch `feature/app-data-contract-v1`.
4. Wait for the job to complete.
5. Download artifact `binance-spot-live-smoke-evidence`.
6. Record the workflow run URL, run timestamp, conclusion, and artifact retention location in the operations log.
7. Treat any failed symbol, missing artifact, or rejected evidence as NOT ACCEPTED. Investigate and rerun; do not infer health from `/healthz`.

## Status boundaries

| Observation | What it proves | What it does not prove |
|---|---|---|
| HTTP `/healthz` responds | Local dashboard process responds | Binance WebSocket connectivity |
| WebSocket opens | A socket connection was established | A usable market quote arrived |
| Fresh validated quote | A normalized quote passed feed contract checks at that instant | Ongoing availability or strategy profitability |
| Five-symbol smoke accepted | All five symbols passed this bounded smoke check | Production SLA, resilience under long duration, or live trading readiness |

## Security and scope

Public market data only. No API keys, account credentials, order permissions, or live order endpoints. The dashboard remains loopback-only, read-only, and PAPER_ONLY.

## Verification status

Automated CI tests validate report construction and evidence validation logic. The actual live network smoke remains unverified until an operator manually runs the GitHub Actions workflow successfully.
