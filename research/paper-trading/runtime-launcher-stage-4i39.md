# Stage 4I.39 — Runtime Launcher & Operational Integration

## Operator command

Node.js 22+ is required. From the repository root:

```sh
npm ci
npm run start:dashboard -- --ledger ./var/paper-ledger.jsonl
```

Open the Dashboard URL printed by the process. The default bind is `127.0.0.1`, port `8787`, and the five default symbols are BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, and XRPUSDT.

The ledger argument is mandatory. Choose a dedicated path and do not point it at an existing unrelated file. The session lock prevents a second runtime from opening the same active ledger.

## Supported options

```sh
npm run start:dashboard -- --ledger ./var/paper-ledger.jsonl \
  --host 127.0.0.1 \
  --port 8787 \
  --symbols BTCUSDT,ETHUSDT,SOLUSDT \
  --selected-symbol BTCUSDT \
  --max-quote-age-ms 5000
```

- `--ledger`: required path; normalized to an absolute path.
- `--host`: only `127.0.0.1` or `::1`; public binds are rejected.
- `--port`: integer 0–65535; 0 asks the OS for an ephemeral port.
- `--symbols`: 1–20 unique symbol identifiers; default five-symbol set.
- `--selected-symbol`: must belong to the configured symbol list.
- `--max-quote-age-ms`: 100–300000; default 5000.
- `--help`: prints usage without starting a session.

## Lifecycle

The launcher prints dashboard, health, API, mode, and ledger paths only after startup succeeds. Ctrl+C (SIGINT) and SIGTERM invoke the same graceful shutdown path. Wait for the confirmation before restarting. If shutdown reports an error, inspect the ledger and lock before attempting recovery; never delete a lock simply to make restart succeed.

## Safety boundaries

- PAPER_ONLY simulation and read-only dashboard only.
- Public Binance Spot market data; no API key or exchange trading permission.
- No live order placement, auto-trading, ledger mutation endpoint, or risk reset endpoint.
- Loopback only; do not expose via tunnel, reverse proxy, public interface, or port forwarding.
- A successful launcher startup or `/healthz` response does not prove that Binance delivered fresh quotes. Inspect per-symbol feed health.
- CI tests do not replace the manual Binance Spot Live WebSocket Smoke workflow.

## Verification

CLI parser tests cover mandatory ledger, safe defaults, loopback restrictions, numeric bounds, symbol validation, selected-symbol membership, unknown/duplicate/missing options, and help behavior. The launcher itself uses the existing tested runtime bootstrap.
