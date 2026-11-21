# Stage 4I.22 — Feed Disconnect, Fail-Closed, and Recovery Validation

## Objective

Verify feed loss and recovery through the complete runtime-to-ledger path, not only as isolated adapter unit behavior.

## End-to-end scenario

1. Start the actual Binance Spot bookTicker adapter with an injected deterministic WebSocket.
2. Receive a valid BTCUSDT quote and persist a paper position mark.
3. Simulate an abnormal socket disconnect.
4. Confirm supervisor health becomes false.
5. Run the next scheduled portfolio mark and confirm the bridge rejects it.
6. Confirm no additional `POSITION_MARKED` event is written while the feed is disconnected.
7. Allow the adapter's bounded reconnect backoff to elapse.
8. Open the replacement socket and receive a new valid quote.
9. Confirm health returns to true and the next runtime cadence writes a new durable mark.
10. Stop the runtime and verify sockets and timers are cleaned up.

## Safety behavior

- A disconnect never causes a stale or synthetic mark to be written.
- Reconnection alone is insufficient; a fresh valid quote is required before marking resumes.
- The ledger retains the prior valid mark as historical evidence.
- The test uses deterministic fake time, fake timers, and a mock WebSocket.

## Evidence

The scenario is covered in `tests/paper-market-data-runtime.integration.test.js`.

This test is not a real network outage drill and does not prove production-grade reconnect behavior under DNS changes, TLS failures, packet loss, exchange throttling, process restart, or multi-host deployment. The manual live smoke check remains a separate prerequisite for real connectivity evidence.
