# Tradesys Crypto Strategy

A deterministic, versioned strategy engine for the Tradesys Crypto application.

## Responsibility

This repository owns strategy specifications, pure calculations and decision state machines, versioned schemas, regression fixtures, automated tests, and reproducible validation reports.

It does **not** own market-data fetching, UI, browser storage, notifications, exchange credentials, or live order execution.

## Current implementation status

- [x] Repository architecture and input/output contract.
- [x] Binance Spot candle normalization and quality checks.
- [x] Technical indicator primitives: EMA, SMA, Wilder, RSI, ATR, ADX, Bollinger Bands, OBV, pivots, percentile rank.
- [x] Initial BTC market-regime classifier and confirmation timeline.
- [x] Initial relative-strength scoring and universe ranking module.
- [x] Initial confirmed-pivot BOS/CHoCH event engine.
- [x] Initial bullish order-block, FVG, and liquidity-level primitives.
- [ ] Zone lifecycle/quality, 1H trigger state machine, and integrated SMC decision engine.
- [ ] Entry/exit and portfolio risk modules.
- [ ] Event-driven backtest and out-of-sample validation.
- [ ] Application adapter integration.

The extracted indicator and regime modules are initial implementations. They must pass executable CI and parity tests against the frozen source before being considered release-ready. No profitability claim is made. BUY remains gated pending data validation, regression tests, and independent out-of-sample/paper-trading acceptance.

## Layout

- `specs/` — canonical, versioned trading rules.
- `schemas/` — versioned engine input/output contracts.
- `src/validation/` — candle normalization and data-quality checks.
- `src/indicators/` — deterministic technical indicators.
- `src/regime/` — benchmark market-regime classification.
- `src/relative-strength/` — aligned asset-versus-BTC performance scoring and deterministic ranking.
- `src/structure/` — confirmed-pivot market-structure events and initial SMC zone/liquidity primitives.
- `src/` — additional pure strategy modules.
- `fixtures/` and `tests/` — deterministic scenarios, regression, and anti-lookahead tests.
- `research/` — audit findings and validation reports.

## Integration boundary

The application fetches and normalizes Binance Spot data, then calls a pinned strategy version through the adapter contract. The engine must not fetch market data or depend on browser APIs.

See [ARCHITECTURE.md](ARCHITECTURE.md), [the static audit](research/audits/2026-11-20-tradesys-crypto-static-audit.md), and [the validation test plan](research/validation/test-plan-v1.md).
