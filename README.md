# Tradesys Crypto Strategy

A deterministic, versioned strategy engine for the Tradesys Crypto application.

## Responsibility

This repository owns:
- strategy specifications and parameter sets;
- pure deterministic calculations and decision state machines;
- versioned input/output schemas;
- fixed test fixtures and automated tests;
- reproducible backtest, walk-forward, and out-of-sample reports.

It does **not** own market-data fetching, UI, browser storage, notifications, exchange credentials, or live order execution.

## Status

- Foundation contract and architecture are documented.
- Static audit of the current application strategy is in `research/audits/`.
- Strategy algorithms have not yet been extracted.
- No profitability claim is made.
- BUY must remain gated until data validation, regression tests, and independent out-of-sample/paper-trading acceptance criteria pass.

## Layout

- `specs/` — canonical, versioned trading rules.
- `schemas/` — versioned engine input/output contracts.
- `src/` — pure strategy modules.
- `fixtures/` — deterministic market scenarios and expected decisions.
- `tests/` — unit, regression, boundary, and anti-lookahead tests.
- `research/` — audit findings and reproducible validation reports.

## Integration boundary

The application fetches and normalizes Binance Spot data, then calls a pinned strategy version through the adapter contract. The engine must not fetch market data or depend on browser APIs.

See [ARCHITECTURE.md](ARCHITECTURE.md), [the static audit](research/audits/2026-11-20-tradesys-crypto-static-audit.md), and [CHANGELOG.md](CHANGELOG.md).
