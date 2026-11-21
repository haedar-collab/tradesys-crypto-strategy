# Stage 4I.28 — Read-only Paper Dashboard UI

## Delivered
- `dashboard/index.html`: responsive browser dashboard shell.
- `dashboard/dashboard.css`: responsive dark UI.
- `dashboard/dashboard.js`: imports a JSON snapshot, builds the existing immutable view model, and renders market, strategy, risk, performance, positions, quality, and permission sections.
- Snapshot import is capped at 2 MiB. Values are rendered with DOM `textContent`; no HTML injection path is used.
- No order, ledger mutation, or risk reset controls exist.

## How to run
From the repository root, use a static server, for example:
`python3 -m http.server 8000`
Then open `http://localhost:8000/dashboard/` in a modern browser. Import a JSON file whose top-level keys match the arguments of `buildPaperDashboardViewModel` (feedStatus, quote, signal, acceptance, ledgerSnapshot, performanceReport, riskStatus, positions, maxQuoteAgeMs).

## Explicit boundary
This is a functional snapshot viewer, not a live runtime integration. It does not open Binance WebSocket, connect to a paper session, fetch ledger files, or generate a trusted snapshot. The imported snapshot can be stale or fabricated. Quote age is recalculated at import time; no continuous refresh occurs. Browser rendering and manual operator review remain deployment checks. Do not use this UI as proof of live connectivity or operational release readiness.

## Validation
- Static UI contract test checks snapshot-only input, no mutation controls, safe text rendering, and reuse of the read-only view model.
- Full CI required before this stage is considered validated.
