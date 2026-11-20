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
- [x] Initial 1H zone-touch, BOS/CHoCH, and sweep-and-reclaim trigger module.
- [x] Initial supply/demand zone quality scoring and deterministic demand-zone selection.
- [x] Initial fail-closed long-only SMC decision gate with HTF, zone-quality, trigger, chase-distance, and R:R checks.
- [x] Initial conservative Weekly/Daily/regime/4H/1H orchestration; full zone lifecycle state machine remains open.
- [x] Initial position sizing, regime exposure, position-count, duplicate-symbol, and correlation risk gates.
- [x] Initial entry/exit plan and partial-profit state machine with same-bar breakeven stop handling.
- [ ] Portfolio stress controls, trailing/forced exit policy, and application risk-state integration.
- [x] Initial single-symbol and aligned multi-symbol event-driven Spot backtests with next-bar entry, fees, slippage, conservative OHLC exits, portfolio exposure/correlation gates, and regression fixtures.
- [x] 1H zone-intersection / invalidation / reclaim state tests and contiguous daily RS history checks.
- [x] Prefix-based anti-lookahead regression checks for confirmed structure events and daily regime decisions.
- [ ] Walk-forward/out-of-sample validation, parameter sensitivity, spread/market-impact calibration, and exchange-realistic execution.
- [ ] Application adapter integration.

The extracted indicator and regime modules are initial implementations. They must pass executable CI and parity tests against the frozen source before being considered release-ready. No profitability claim is made. BUY remains gated pending data validation, regression tests, and independent out-of-sample/paper-trading acceptance.

## Layout

- `specs/` — canonical, versioned trading rules.
- `schemas/` — versioned engine input/output contracts.
- `src/validation/` — candle normalization and data-quality checks.
- `src/indicators/` — deterministic technical indicators.
- `src/regime/` — benchmark market-regime classification.
- `src/relative-strength/` — aligned asset-versus-BTC performance scoring and deterministic ranking.
- `src/structure/` — confirmed-pivot market-structure events, SMC zone/liquidity primitives, zone quality/selection, 1H trigger logic, and SMC decision gate.
- `src/risk/` — pure position sizing, portfolio exposure/correlation gates, and trade-plan/exit state machine.
- `src/engine/` — conservative multi-timeframe strategy orchestration.
- `src/backtest/` — single-symbol and aligned multi-symbol event-driven Spot simulators; research-only until execution calibration and out-of-sample validation.
- `src/` — additional pure strategy modules.
- `fixtures/` and `tests/` — deterministic scenarios, regression, and anti-lookahead tests.
- `research/` — audit findings and validation reports.

## Integration boundary

The application fetches and normalizes Binance Spot data, then calls a pinned strategy version through the adapter contract. The engine must not fetch market data or depend on browser APIs.

See [ARCHITECTURE.md](ARCHITECTURE.md), [the static audit](research/audits/2026-11-20-tradesys-crypto-static-audit.md), and [the validation test plan](research/validation/test-plan-v1.md).
