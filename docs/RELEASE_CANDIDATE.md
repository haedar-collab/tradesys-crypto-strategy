# Release Candidate — Tradesys Crypto Paper Dashboard

**Status:** Release candidate; not approved for unattended or production trading use.  
**Branch:** `feature/app-data-contract-v1`  
**Validated commit:** `4218b544bd52a1ffec0da3d32d9c4a5981bd69b7`  
**CI:** GitHub Actions run [44913333727](https://github.com/haedar-collab/tradesys-crypto-strategy/actions/runs/44913333727) — 432 tests passed, 0 failed.

## Scope delivered

- Local read-only dashboard in `PAPER_ONLY` mode.
- Public Binance Spot market data; no API key or exchange credentials required.
- Default quote-feed universe: BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT.
- Multi-timeframe screener (1W, 1D, 4H, 1H) using closed candles; default refresh cache is 60 seconds.
- Screener candle cutoff is enforced at the adapter boundary using the conservative evaluation/server-time cutoff.
- Persistent paper ledger, recovery/risk gates, and read-only performance/dashboard views.
- Local mode binds only to loopback. Optional hosted mode binds to `0.0.0.0` only with explicit opt-in and strong HTTP Basic credentials; hosted deployment relies on Render HTTPS termination.
- HTTP transport accepts GET only and does not expose raw ledger events or broker internals.
- Render deployment blueprint and setup guide are provided in `render.yaml` and `docs/ONLINE_DEPLOYMENT.md`; deployment is not yet provisioned.
- No exchange order submission, auto-trading, or live execution capability is included.

## Requirements

- Node.js 22 or newer.
- Network access to public Binance Spot REST and WebSocket endpoints.
- A writable local directory for the persistent paper ledger.

## Run locally

From the repository root:

```bash
node --version
npm test
npm run start:dashboard -- --ledger ./var/paper-ledger.jsonl
```

Open `http://127.0.0.1:8787/dashboard/`. Health endpoint: `http://127.0.0.1:8787/healthz`.

The launcher requires an explicit `--ledger` path. Keep this file in a persistent, private, backed-up directory. Do not share or commit the ledger. Stop the process with Ctrl+C; the runtime performs a graceful paper-session shutdown.

Optional arguments:

- `--port 8787` (use `0` to select an ephemeral port)
- `--symbols BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT` (1–20 unique symbols)
- `--selected-symbol BTCUSDT`
- `--max-quote-age-ms 5000`

The launcher rejects non-loopback hosts by default. Remote binding requires `TRADESYS_ALLOW_REMOTE=true`, a username, and a password of at least 24 characters. Use only behind a hosting provider that enforces HTTPS; never expose the Node service directly over plaintext internet.

## Online deployment status

The Render Blueprint uses a paid Starter web service and a 1 GB persistent disk. The service is configured for one instance because the file-backed paper ledger uses local filesystem locking. Review the plan and disk charges before creating the service. No hosted URL exists until the owner connects the repository and provisions the Render Blueprint. See `docs/ONLINE_DEPLOYMENT.md`.

## Acceptance still required

The following are deliberately open; automated unit/integration CI does not replace them:

1. **Live Binance WebSocket smoke:** manually run the [Binance Spot Live WebSocket Smoke workflow](https://github.com/haedar-collab/tradesys-crypto-strategy/actions/workflows/binance-spot-live-smoke.yml) on this branch. Confirm all five symbols pass and retain the `binance-spot-live-smoke-evidence` artifact. This evidence is time-bound and must not be treated as a permanent availability guarantee.
2. **Live REST screener check:** start the dashboard with network access and confirm the 1W/1D/4H/1H candle fetches return usable closed-candle history, and that a symbol-level fetch failure is reported without fabricating a candidate.
3. **Browser acceptance:** manually inspect dashboard loading, screener status/reasons, stale/degraded feed handling, and graceful shutdown in a supported browser.
4. **Paper observation:** run in paper-only mode and review data quality, signal frequency, risk gating, ledger persistence, and recovery before considering any broader use.

Until these checks are completed, label the system **release candidate / live acceptance pending**. A passing CI run does not establish strategy profitability, execution quality, or suitability for real-money trading.

## Release controls

- Keep work on `feature/app-data-contract-v1` until the owner explicitly authorizes a merge.
- Do not merge to `main`, create a production release, enable live orders, or describe signals as guaranteed recommendations based solely on this candidate.
- No exchange API credentials should be added for the current public-market-data scope.
