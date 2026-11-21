# Stage 4I.29 — Runtime Snapshot Adapter

## Delivered
- `src/paper/paper-dashboard-runtime-adapter.js` composes a compatible in-process paper session snapshot with read-only feed and strategy providers.
- It validates PAPER_ONLY mode and complete, internally consistent ledger event counts before projection.
- It derives positions from broker state and only uses a durable POSITION_MARKED record when its quantity matches the current broker position.
- It builds analytics from the persistent ledger adapter; it does not synthesize equity marks.
- The existing dashboard view model remains the only UI projection and enforces fixed read-only permissions.
- Missing feed/strategy providers default to disconnected/not evaluated. Stale quote logic remains in the view model.

## Integration contract
The host application calls `createPaperDashboardRuntimeSnapshot({ session, feedProvider, strategyProvider, maxQuoteAgeMs, now })`. Providers are read-only callbacks returning:
- feed: `{ status, quote }`
- strategy: `{ signal, acceptance }`

The session must expose only the read methods `snapshot()` and `riskStatus()` to this adapter. Do not pass broker mutation methods or exchange credentials.

## Limitations
- This adapter is an in-process composition function, not an HTTP server or browser push channel.
- No Binance WebSocket is created here. A feed provider must be implemented and independently validated by the host.
- The browser UI still imports a JSON snapshot; automatic polling/push transport is a separate integration.
- It does not authenticate snapshot origin or prove the supplied providers are trustworthy.
- Paper-only, read-only; never submits orders or mutates the ledger.

## Validation
Tests cover complete snapshot composition, incomplete ledger rejection, incompatible session rejection, missing provider behavior, and stale quote handling.
