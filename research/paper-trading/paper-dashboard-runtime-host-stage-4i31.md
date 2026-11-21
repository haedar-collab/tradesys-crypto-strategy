# Stage 4I.31 — Paper Dashboard Runtime Host

## Delivered
- `src/paper/paper-dashboard-runtime-host.js` composes the persistent paper session, runtime snapshot adapter, and loopback HTTP transport.
- Startup requires an explicit persistent ledger path and supports PAPER_ONLY only.
- The host returns only `address()` and `close()`; it does not expose the mutable paper session or order submission methods.
- Feed and strategy providers are injectable. Defaults are explicitly disconnected/not evaluated, never simulated as live.
- Startup failure closes the session and releases the ledger lock. Graceful shutdown stops the HTTP server and closes the session, persisting SESSION_STOPPED.

## Example
```js
import { startPaperDashboardRuntimeHost } from "./src/paper/paper-dashboard-runtime-host.js";

const host = await startPaperDashboardRuntimeHost({
  filePath: "./data/paper-ledger.jsonl",
  port: 8787
});
console.log("Open http://127.0.0.1:" + host.address().port + "/dashboard/");
// On application shutdown: await host.close();
```

The default feed is DISCONNECTED and the default strategy is NOT_EVALUATED. A validated feed/strategy provider must be supplied by the real application before dashboard signals can be considered operational.

## Limitations
- This host does not create Binance WebSocket connectivity or a strategy engine.
- It does not submit orders; the mutable session is intentionally not returned.
- Local loopback is not authentication against malicious processes running on the same machine.
- No public bind, remote dashboard, or live-trading mode is supported.

## Validation
Tests start the full local host with a temporary ledger, verify same-origin dashboard and API responses, confirm default disconnected state and read-only permissions, and verify graceful shutdown persists SESSION_STOPPED.
