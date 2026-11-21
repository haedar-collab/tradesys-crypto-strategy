# Stage 4I.38 — Runtime Operations & Deployment Readiness

## Purpose and boundary

This runbook covers the local read-only Binance Spot dashboard backed by a persistent PAPER_ONLY session. It is an operator procedure, not a live-trading deployment guide.

- Node.js 22 or newer is required (the project uses the built-in WebSocket implementation).
- Binance public market data uses unauthenticated market-data streams. Do not add API keys or exchange credentials.
- The dashboard binds to loopback only. It is intended for use on the same machine.
- Paper broker/session state is local simulation state. No live orders are submitted.
- Keep the strategy branch separate; do not treat a passing CI run as production or live-market acceptance.

## Prerequisites

1. Use a trusted machine with Node.js 22+ and npm.
2. Clone the repository and check out `feature/app-data-contract-v1`.
3. Install dependencies with `npm ci`.
4. Choose a dedicated persistent ledger path with sufficient disk space. The process creates the parent directory and ledger when needed.
5. Ensure no other process is using that ledger. A sibling `.lock` file protects the ledger for the lifetime of the session.

Check versions:

```sh
node --version
npm --version
```

## Start the runtime

The runtime is exported as a library entry point. Start it from a small local launcher or an application entry point; always pass an explicit ledger path and keep the default loopback bind:

```js
import { startBinanceSpotPaperDashboardRuntime } from "./src/paper/binance-spot-paper-dashboard-runtime.js";

const runtime = await startBinanceSpotPaperDashboardRuntime({
  filePath: "./var/paper-ledger.jsonl",
  host: "127.0.0.1",
  port: 8787
});

console.log("Dashboard:", `http://127.0.0.1:${runtime.address().port}/dashboard/`);
console.log("Health:", `http://127.0.0.1:${runtime.address().port}/healthz`);

let closing;
async function shutdown() {
  closing ??= runtime.close();
  await closing;
}
process.once("SIGINT", () => { shutdown().then(() => process.exit(0), () => process.exit(1)); });
process.once("SIGTERM", () => { shutdown().then(() => process.exit(0), () => process.exit(1)); });
```

Run the entry point with Node.js 22. Do not expose the service through a reverse proxy, public interface, tunnel, or port-forwarding rule.

## Health checks

- `GET /healthz`: confirms the local HTTP process responds in PAPER_ONLY, read-only mode. It does not prove Binance connectivity.
- `GET /api/paper-dashboard`: returns the sanitized dashboard snapshot. Inspect market aggregate state and each symbol's health.
- `GET /dashboard/`: opens the dashboard UI.

Market status meanings:

| State | Operator interpretation |
|---|---|
| DISCONNECTED | No active usable market feed |
| WAIT_DATA | Feed started but no fresh valid quote has arrived |
| DEGRADED | One or more configured symbols are unhealthy |
| CONNECTED | All configured symbols are healthy and fresh |

A connected HTTP health endpoint is not equivalent to a healthy market feed. Do not use stale or missing quotes as decision inputs.

## Normal shutdown

Use Ctrl+C or send SIGTERM to the launcher. Wait for shutdown to finish before restarting. Shutdown stops market feeds, closes the HTTP server, and closes the paper session so its stop event and ledger lock are handled. Concurrent shutdown calls share the same teardown operation.

Do not kill the process forcibly unless it is unresponsive and you accept that recovery may require operator review.

## Restart and recovery

1. Confirm the previous process has exited.
2. Check whether the ledger's sibling `.lock` file remains.
3. If a lock remains, do not delete it automatically. Determine whether the prior process is still alive and inspect the lock metadata. A stale lock requires manual review.
4. Restart with the exact same session configuration. The immutable session header rejects configuration drift.
5. If startup rejects an incomplete, corrupt, unsupported, or inconsistent ledger, stop. Preserve the original file and follow the recovery/migration procedures; do not hand-edit JSONL or bypass the recovery gate.
6. Back up the ledger only while the owning process is stopped and the lock is released. Keep backups access-controlled; ledger contents may contain simulated account state.

Never copy an active ledger and treat the copy as a consistent point-in-time backup.

## Diagnostics and escalation

- `WAIT_DATA`: check outbound network access, DNS, and whether the runtime has just started.
- `DEGRADED`: inspect per-symbol reasons; a healthy subset does not make the aggregate feed fully healthy.
- A symbol reconnect should clear its old supervisor error. If the symbol remains unhealthy, investigate the current reason rather than assuming the historical error is still active.
- Ledger lock / recovery errors: stop and preserve files; do not auto-delete locks, truncate records, or replay pending orders.
- HTTP `503`: snapshot is unavailable, invalid, not read-only, or too large. Treat dashboard data as unavailable.

## Required live-network verification

The CI suite uses deterministic tests and mock feeds. It does not prove public Binance WebSocket reachability from the operator's machine.

Run the manual GitHub Actions workflow **Binance Spot Live WebSocket Smoke** from the repository's Actions tab. It checks BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, and XRPUSDT using Node 22. Record the run URL, timestamp, and result in the operational log. Do not mark live connectivity verified until that workflow has completed successfully.

## Security and release gate

- No exchange API keys, secrets, or trading permissions are required.
- Do not bind to `0.0.0.0`; the HTTP server rejects non-loopback hosts.
- Dashboard endpoints are GET-only and do not expose order submission, ledger mutation, or risk reset operations.
- No auto-repair, stale-lock stealing, order replay, or forced liquidation is provided.
- Passing tests is not a live-trading authorization. This runtime remains PAPER_ONLY and read-only.

## Stage 4I.38 verification scope

The stage includes a shutdown reliability correction: session teardown is now attempted even if feed or HTTP shutdown reports an error, and simultaneous close callers await the same shutdown promise. A dedicated test verifies a single feed stop and a single SESSION_STOPPED event under concurrent shutdown calls.

The separate manual Binance WebSocket smoke test remains outstanding until an operator runs it successfully.
