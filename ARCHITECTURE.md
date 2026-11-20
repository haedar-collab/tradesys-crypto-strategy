# Strategy Engine Architecture

## Responsibility
Canonical home for versioned strategy rules and deterministic decisions consumed by `tradesys-crypto`.

## Dependency rule
The engine accepts normalized market snapshots and user risk constraints. It returns structured analysis, evidence, invalidation, and risk decisions. It must not call external APIs, read browser storage or secrets, send notifications, place orders, or mutate application state.

## Pipeline
1. Validate schema, timestamps, candle ordering, closure state, and data freshness.
2. Determine market regime from supplied benchmark context.
3. Evaluate eligible universe and relative strength.
4. Evaluate multi-timeframe structure and SMC evidence.
5. Score setup quality and wait for explicit trigger confirmation.
6. Calculate invalidation, entry, stop, targets, and reward/risk.
7. Apply account-level risk constraints.
8. Emit a decision with rule IDs, strategy version, and audit metadata.

Critical validation failure produces `WAIT_DATA` or `BLOCKED`, never BUY.

## Modules
- `src/validation/` — input and data-quality checks.
- `src/regime/` — market regime classification.
- `src/universe/` — eligibility and relative strength.
- `src/structure/` — market structure and SMC primitives.
- `src/setups/` — setup and trigger state machine.
- `src/risk/` — sizing constraints and risk gates.
- `src/engine/` — orchestration and output assembly.

## Validation requirements
- No lookahead: pivots and swings become usable only after confirmation.
- Confirmed signals use closed candles; forming candles are display-only.
- Backtests model fees, spread, slippage, fill assumptions, and ambiguous OHLC bars conservatively.
- Use chronological out-of-sample and walk-forward evaluation.
- Report results by symbol, regime, and time period.
- Preserve strategy version and parameter hash for every result.

No profitability claim or live execution authorization follows from unit tests or a backtest alone.


## Extracted modules (initial)

- `src/validation/candles.js`: normalizes Binance Spot klines, excludes forming candles by default, and reports timestamp, OHLC, volume, interval-gap, and staleness issues.
- `src/indicators/index.js`: pure EMA/SMA/Wilder/RSI/ATR/ADX/Bollinger/OBV/pivot/percentile calculations.
- `src/regime/index.js`: BTC daily regime classifier and N-bar effective regime timeline.

The extracted regime module deliberately preserves the current application's regime labels, rule ordering, fallback behavior, and transition behavior. This is parity-first extraction, not a strategy redesign. Known legacy behaviors remain documented for separate decisions, including initial regime seeding before confirmation and the current pivot confirmation filter.


- `src/relative-strength/index.js`: aligned daily asset-versus-BTC relative-return scoring (7/30/90-day weighted score), five-day score snapshot, ratio trend check, and deterministic top-percentile ranking. The application still owns the Binance symbol universe, exchange eligibility filters, quote-volume thresholds, stablecoin/tokenized-stock exclusions, and external float enrichment.

- `src/structure/events.js`: confirmed-pivot BOS/CHoCH event stream with legacy event ordering and trend-state semantics. Order blocks, FVG, liquidity sweeps, zone lifecycle, and 1H trigger logic remain separate extraction tasks.

- `src/structure/zones.js`: bullish order-block discovery/invalidation, unfilled bullish FVG discovery with partial-fill handling, equal-high buy-side liquidity, sell-side liquidity, and sweep/reclaim detection. Zone selection, zone quality, and final SMC signal policy remain higher-level responsibilities.

- `src/structure/ltf-trigger.js`: 1H demand-zone touch detection, invalidation, bullish BOS/CHoCH confirmation, and swing-low sweep/reclaim confirmation. It preserves the legacy trigger priority and requires the 4H zone context to be supplied by the caller.

- `src/structure/quality.js`: departure strength, DBR/RBR/RBD/DBD base classification, base candle count, and retest/freshness scoring for supply and demand zones.
- `src/structure/select-zone.js`: deterministic long-side demand-zone selection, prioritizing discount location and OB/FVG overlap before proximity, with nearest valid FVG fallback. It returns the candidate list for auditability.

- `src/structure/decision.js`: fail-closed long-only SMC policy gate. It requires bullish Daily bias (configurable), non-bearish 4H structure, a valid unbroken zone, acceptable zone quality, an explicit entry trigger, bounded 1H chase distance, and minimum planned/current R:R. It emits `BUY_CANDIDATE` for research review only; it does not size positions or place orders.

- `src/risk/portfolio.js`: fixed-fractional spot sizing from stop distance, regime/drawdown/event multipliers, available-exposure cap, Pearson return correlation, duplicate-symbol guard, max-position count, and regime exposure cap. The application must supply verified account equity, open/pending positions, and aligned return series; no balances or exchange state are fetched by this module.

- `src/risk/trade-plan.js`: long-only entry midpoint, ATR-bounded stop, resistance-based TP1–TP3 with measured-move fallback, 40/40/20 scale-out, and breakeven stop transition. Same-bar stop/target ambiguity is resolved conservatively by checking the active stop first. This is a deterministic plan state machine, not an order manager.

- `src/engine/multi-timeframe.js`: conservative Weekly/Daily/benchmark-regime/4H demand-zone/1H trigger orchestration. Provisional weekly context, unconfirmed benchmark regime, bearish higher-timeframe context, invalid zones, and broken 1H zones block new research candidates. This module accepts pre-fetched normalized context only.
- Exit-state safety: after TP1, if the same OHLC bar also trades through the newly activated breakeven stop, the engine assumes TP1 occurred first and closes the remainder at breakeven. The pre-existing stop is still checked first. This removes an optimistic same-bar path but does not replace lower-timeframe execution data.

- `src/backtest/event-driven.js`: single-symbol long-only spot event simulator. A signal formed at bar close can only enter at the next bar open; the entry bar is then simulated, and stop/target ambiguity follows the conservative exit state machine. It caps notional to available spot equity, applies fee and adverse-slippage assumptions on entry and every exit tranche, rejects excessive entry gaps or degraded live R:R, and reports closed-trade metrics separately from any open mark-to-market position. Drawdown is explicitly realized-equity drawdown and excludes open-position mark-to-market.

- `src/backtest/portfolio.js`: aligned multi-symbol Spot portfolio simulator. It applies max-position and regime-exposure limits, blocks duplicate symbols, requires aligned return histories for correlation checks when positions are active, and sizes new positions from risk budget and remaining exposure. Assets must share identical timestamps; candidate priority is deterministic. This is an initial simplified portfolio simulator, not an exchange-matching engine.

- `evaluateDrawdownRisk` in `src/risk/portfolio.js`: normal/reduced/blocked new-entry states with hysteresis. New entries are blocked at the drawdown limit and remain blocked until drawdown recovers to the configured recovery threshold; the reduced state scales risk before the hard limit.
- The multi-symbol backtest applies the drawdown guard to new entries using realized equity and the realized equity peak. Open-position mark-to-market drawdown is not yet part of this guard.

- Relative-strength inputs must share the same latest timestamp and a contiguous daily observation sequence. The default interval is 86,400,000 ms; callers with a different daily candle convention may set `expectedIntervalMs`. A missing aligned daily interval returns `WAIT_DATA / HISTORY_GAP`, rather than treating the next available observation as an exact 7/30/90-day bar.
- The 1H trigger distinguishes actual OHLC zone intersection from a candle entirely beyond the zone, and returns explicit zone states `UNTOUCHED`, `TOUCHED`, `RECLAIMED`, or `BROKEN`. A close below the ATR invalidation buffer inside the trigger lookback blocks the setup.

- Anti-lookahead regression tests compare confirmed structure events and daily regime outputs from historical prefixes against the same timestamps in full-history runs. These tests do not yet cover the full SMC zone/trigger/plan pipeline.
