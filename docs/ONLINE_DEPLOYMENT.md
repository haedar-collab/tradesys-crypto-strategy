# Online Deployment — Private Render Service

**Deployment target:** Render Web Service  
**Branch:** `feature/app-data-contract-v1`  
**Application mode:** `PAPER_ONLY`  
**Public order execution:** Not implemented.

## Architecture and security

- Render terminates public HTTPS and forwards traffic to the Node.js service.
- The service binds to `0.0.0.0` only when `TRADESYS_ALLOW_REMOTE=true` and both dashboard credentials are configured.
- Dashboard routes and the JSON snapshot API require HTTP Basic authentication. Use a unique password of at least 24 characters.
- `/healthz` is intentionally unauthenticated and returns only a generic health/mode status for the hosting health probe.
- The paper ledger is stored under `/var/data`, backed by a Render persistent disk.
- Keep one service instance. The persistent ledger uses local filesystem locking and is not designed for multi-instance concurrent access.
- No Binance API keys are required. Only public Spot market data is used.
- No live order submission, auto-trading, or exchange credentials are enabled.

## Deploy

1. Sign in to Render and choose **New → Blueprint**.
2. Connect the GitHub repository `haedar-collab/tradesys-crypto-strategy`.
3. Select branch `feature/app-data-contract-v1` (do not select `main`).
4. Review the service plan and persistent disk cost shown by Render. The Blueprint requests the Starter web-service plan and a 1 GB persistent disk; both are paid resources. Do not proceed unless the displayed cost is acceptable.
5. During initial Blueprint setup, provide:
   - `TRADESYS_DASHBOARD_USER`: a non-default username.
   - `TRADESYS_DASHBOARD_PASSWORD`: a randomly generated password with at least 24 characters. Store it in a password manager; never commit it.
6. Create the Blueprint. Auto-deploy is disabled; deploy the service manually after reviewing its environment and disk settings.
7. Wait for the deploy and `/healthz` check to pass. Open the HTTPS `onrender.com` URL and authenticate in the browser. The dashboard is at the root path `/dashboard/` only if routed through the service's dashboard endpoint; use `/dashboard/` as the application URL.
8. Confirm the Market Feed and Screener show current data. A healthy HTTP process alone does not prove Binance feed or screener acceptance.

## Operational constraints

- Do not remove or replace the persistent disk. Back up the ledger before any destructive change.
- Do not scale this service above one instance while using the file-backed ledger.
- Do not expose the Node service except through Render's HTTPS web-service endpoint.
- Keep the repository branch and deployment branch aligned. The Blueprint has auto-deploy disabled to prevent an unreviewed commit from being published.
- The app is a release candidate. Complete live WebSocket smoke, live REST screener, browser, and paper-observation checks before relying on it operationally.
- After a crash, OOM kill or redeploy, the next container reclaims the ledger lock automatically: on Render the volume is treated as exclusive (`RENDER=true` / `--exclusive-volume`), so a lock created before the current container started belongs to a dead instance. Keep the start command as `npm run start:dashboard …` (the script `exec`s Node so SIGTERM reaches it) or call `node scripts/start-binance-spot-dashboard.js …` directly; never wrap it in another shell that does not forward signals.
- If startup fails with `paper recovery audit blocked activation: REVIEW`, an order was interrupted before a durable fill. Suspend the service, open the Render shell and run `npm run paper:resolve-review -- --ledger /var/data/paper-ledger.jsonl --list`, then resolve each order with `--client-order-id ID --reviewer NAME --note "evidence"`. Resume the service afterwards.
- Basic authentication is a simple single-user access gate, not multi-user account management or role-based access control. Rotate the password if it is exposed.

## Local development

The existing local command remains unchanged:

```bash
npm run start:dashboard -- --ledger ./var/paper-ledger.jsonl
```

It binds to loopback by default and does not require remote credentials.
