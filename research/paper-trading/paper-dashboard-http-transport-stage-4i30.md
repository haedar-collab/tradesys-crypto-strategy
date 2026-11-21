# Stage 4I.30 — Read-Only Dashboard HTTP Transport

## Delivered
- `src/paper/paper-dashboard-http-server.js` exposes `GET /api/paper-dashboard` and `GET /healthz`.
- Binds only to IPv4/IPv6 loopback by default; non-loopback bind requests are rejected.
- Only GET is accepted. There are no order, ledger-write, risk-reset, or exchange-control routes.
- The HTTP response contains the read-only dashboard view model and limited provenance metadata only. Raw broker state and ledger events are not transmitted.
- Responses use no-store cache headers, JSON content type, nosniff, no-referrer, and a restrictive content security policy.
- Invalid permission envelopes, oversized responses, and provider failures fail closed.

## Host integration
Start the HTTP server with `await startPaperDashboardHttpServer({ port, host: "127.0.0.1", getSnapshot })`; the helper binds the socket to loopback before returning. The callback calls `createPaperDashboardRuntimeSnapshot(...)`. The application host owns session creation, feed provider, strategy provider, and shutdown. Do not pass exchange credentials to this transport.

The dashboard can request `/api/paper-dashboard` from the same origin. The static dashboard must be served by a trusted local host on that origin; this transport intentionally does not serve static assets. A reverse proxy or public bind is not supported.

## Security and limitations
- Loopback binding limits exposure to the local machine; it is not user authentication and does not protect against malicious local processes.
- No TLS or remote access is provided.
- This transport does not create Binance connectivity or instantiate a paper session.
- It does not serve the dashboard static files; deploy the static dashboard on the same origin using a trusted local host.
- Polling interval and browser refresh are client responsibilities.
- Paper-only and read-only. HTTP transport is not an execution API.

## Validation
Tests cover read-only response projection, raw-ledger non-disclosure, GET-only routing, unknown route rejection, invalid snapshots, provider errors, response size limits, and loopback-only bind configuration.
