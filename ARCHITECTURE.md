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
