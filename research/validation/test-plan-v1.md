# Strategy Engine v1 — Validation Test Plan

Status: planned acceptance tests. These tests must exist and pass before extracted strategy logic is allowed to issue actionable decisions.

## 1. Data validation

- Reject empty OHLCV series.
- Reject non-finite values, zero/negative prices, negative volume, and inconsistent OHLC ranges.
- Reject duplicate or descending open/close timestamps.
- Detect missing expected intervals and stale final candles.
- Distinguish closed candles from forming candles.
- Reject mixed symbols, mixed intervals, and inconsistent timestamp units.
- Verify normalized Binance Spot candle timestamps against exchange metadata.

Expected behavior: critical data errors produce `WAIT_DATA` and an explicit reason code. They never degrade silently into a valid-looking setup.

## 2. Indicator parity

For EMA, SMA, Wilder smoothing, RSI, true range, ATR, ADX, Bollinger Bands, OBV, and rolling percentile:
- compare extracted module output against the frozen application baseline;
- test minimum warm-up length, constant prices, monotonic prices, zero volume, missing values, and boundary indices;
- document initialization and null semantics.

## 3. Regime state machine

- one-bar regime change does not become confirmed when confirmation bars are required;
- confirmed transition occurs on the exact configured bar;
- unknown/incomplete inputs cannot inherit a stale regime without an explicit policy;
- verify Uptrend, Sideways, Compression, Capitulation, and Downtrend fixtures;
- verify BTC Daily and 4H context timestamps align.

## 4. Relative strength and universe

- asset and BTC daily close timestamps must be aligned at the latest candle;
- 7/30/90-day returns are measured over the same common timestamp sequence;
- score weights are non-negative and the fallback for unavailable 90-day return is documented;
- insufficient aligned history and as-of mismatch return WAIT_DATA;
- deterministic rank tie-breaking and top-percentile cutoff are tested.

### Original checks

- calculate 7/30/90-day relative returns against BTC from aligned timestamps;
- verify missing history does not silently substitute an invalid period;
- test stablecoin/leveraged-token exclusions and listing-age requirements;
- verify ranks are deterministic for ties;
- test watchlist mode separately from full-universe top-percent mode.

## 5. Structure and SMC

- pivot becomes available only after the configured right-side bars close;
- BOS and CHoCH use only confirmed pivots and closed candles;
- bullish and bearish order blocks have explicit invalidation;
- FVG formation, partial fill, full fill, and invalidation are tested;
- liquidity sweep and reclaim are separate states;
- zone touch, deep penetration, reclaim, and close-through invalidation are distinct;
- 1H trigger cannot confirm before the 4H zone has been tagged;
- weekly context labels partial current week as provisional.

## 6. Entry, stop, targets, and expiry

- entry/stop/target prices are finite and ordered for Spot long setups;
- stop is below entry; targets are above entry;
- reward/risk is recalculated at the actual modeled fill;
- no signal if the minimum R:R is not met;
- frozen plan levels remain stable only while the zone identity and validity remain unchanged;
- expiry and invalidation work at exact timestamp boundaries.

## 7. Risk engine

- position size is derived from equity risk budget and stop distance;
- position size is capped by free regime exposure;
- regime position count, pending signals, open positions, and correlation caps are respected;
- zero/negative equity, invalid stop distance, missing prices, and invalid risk parameters block sizing;
- drawdown and event-risk multipliers are applied once and are auditable;
- aggregate worst-case risk is reported, not just notional exposure.

## 8. Backtest execution model

- stop-only and target-only bars;
- stop and TP1 touched in the same candle;
- TP1 and breakeven stop touched in the same candle;
- TP1 and TP2 touched in the same candle;
- gaps through stop or target;
- partial exits and remaining position accounting;
- fees on each fill, spread, and configurable slippage;
- no entry on the same historical bar unless the execution contract explicitly permits it;
- conservative handling where OHLC cannot reveal intrabar order.

## 9. Anti-lookahead and reproducibility

For every historical timestamp T:
- run the engine using only data available at T;
- rerun using the complete dataset but truncate all feature availability to T;
- assert identical decisions and evidence;
- record strategy version, schema version, parameter hash, data snapshot ID, and evaluation timestamp.

## 10. Release acceptance

No release based on a single aggregate profit factor. Require:
- sufficient trade count and independent out-of-sample coverage;
- chronological walk-forward results;
- fees, spread, and slippage stress tests;
- performance by symbol, regime, and volatility bucket;
- maximum drawdown and loss-streak limits;
- parameter sensitivity and benchmark comparison;
- paper-trading evidence over a pre-agreed observation window.

A failed gate returns a non-actionable strategy status. This plan does not itself validate or certify the strategy.
