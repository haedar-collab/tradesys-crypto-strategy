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

These are extraction increments, not a production release. CI and parity validation remain mandatory.
