# Changelog

## 0.1.0 — Foundation
- Establish strategy-only repository responsibility.
- Define the v1 input/output contract.
- Record data-quality, anti-lookahead, risk, and release gates.


## Unreleased — extraction increment

- Added Binance Spot candle normalization and data-quality gates.
- Added pure technical indicator primitives and preserved the legacy numeric pivot index shape.
- Added an initial BTC daily regime classifier and N-bar effective regime timeline, retaining current legacy rule order and state behavior.
- Added aligned 7/30/90-day asset-versus-BTC relative-strength scoring and deterministic top-percentile ranking.
- Added unit fixtures for candle validation, indicators, regime transitions, and relative strength.
- Added GitHub Actions Node.js test workflow.

Latest CI run: 35 tests passed, 0 failed. These are extraction increments, not a production release. Full integration, broader parity validation, and strategy-performance validation remain mandatory.


## 0.2.0 — Strategy orchestration and research backtest
- Added conservative Weekly/Daily/benchmark-regime/4H/1H orchestration.
- Added same-bar TP1-to-breakeven stop handling and fail-closed portfolio correlation inputs.
- Added single-symbol event-driven spot backtest with next-bar entries, entry-bar processing, fees, slippage, spot-equity cap, and conservative OHLC exit policy.
- Added deterministic regression tests for the new orchestration and simulator. This remains a research implementation, not a validated profitable strategy.

- Added aligned multi-symbol Spot portfolio simulation with position-count, exposure and correlation gates.

- Added a hysteretic drawdown guard with risk reduction and a hard new-entry block, integrated into portfolio backtesting.

- Tightened 1H demand-zone touch semantics to require actual OHLC intersection and separated untouched/touched/reclaimed/broken states.
- Added contiguous daily-history validation for 7/30/90-day relative-strength calculations.
- CI regression suite expanded to 93 passing tests.
- Added historical-prefix anti-lookahead tests for confirmed structure events and daily regime decisions.
- CI regression suite expanded to 95 passing tests.
- Added explicit historical `asOf` boundaries to zone quality, departure strength and retest counting; zone visits now require actual OHLC intersection.
- Added regression tests for historical zone-quality stability, future-candle mutation, and OB/FVG snapshots before later invalidation/fill.
- CI regression suite expanded to 98 passing tests.
