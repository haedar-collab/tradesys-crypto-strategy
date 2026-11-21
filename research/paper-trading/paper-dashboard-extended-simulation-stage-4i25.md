# Stage 4I.25 — Extended Paper Dashboard Simulation

## Objective
Exercise the dashboard read model against persistent paper-session snapshots through a multi-symbol lifecycle, feed loss/recovery, kill-switch activation, exits, and process-style session restart.

## Test
- `tests/paper-dashboard-extended-simulation.test.js`
- Uses the real persistent paper session, hash-chained ledger, broker replay, performance ledger adapter, and dashboard view-model.
- Three symbols: BTCUSDT, ETHUSDT, SOLUSDT.
- Opens positions, writes durable portfolio marks, projects a healthy dashboard, simulates disconnected feed without writing a mark, reconnects with fresh quotes and persists a new mark.
- Latches the kill switch, verifies dashboard visibility, exits all positions, closes and reopens the session, and verifies recovery audit, persistent risk latch, final analytics, and flat portfolio.

## Safety assertions
- Disconnected feed hides bid/ask and does not create a synthetic POSITION_MARKED event.
- Dashboard remains read-only.
- Kill switch remains latched across restart.
- SELL exits remain possible while new BUY entries are blocked by the kill switch.
- Performance comes only from the verified persistent ledger.

## Validation boundary
This is a deterministic local simulation using supplied quote fixtures. It is not a live Binance network test, exchange execution test, or profitability proof.

Run: `npm test`.
