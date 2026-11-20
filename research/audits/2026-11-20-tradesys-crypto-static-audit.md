# Tradesys Crypto — Static Strategy Audit

Date: 2026-11-20
Source repository: `haedar-collab/tradesys-crypto`
Source branch: `main`
Source file: `index.html`
Source blob: `ff35ac7471bc2fdc18904b85bfb5d7e36c69fd69`
Method: static source inspection. No browser runtime, historical data replay, or independent profitability validation was performed.

## Executive result

The current application contains a substantial embedded strategy engine. The main strategy boundary is concentrated in the following functions:

- Indicators and preparation: `ema`, `sma`, `wilder`, `rsi`, `atr`, `adx`, `bbands`, `obv`, `pivotsAll`, `series`, `prepare` (approximately lines 978–1010).
- Regime and playbooks: `structureAt`, `regimeRaw`, `regimeTimeline`, `setupAt`, `backtest` (approximately 1011–1114).
- Structure/SMC: `structureEvents`, `weeklyContext`, `ltfTrigger`, `zoneQuality`, `supplyAbove`, `smcAnalyze` (approximately 1219–1508).
- Backtest and statistics: `simExit`, `backtestSignal`, `backtestCoin`, `coinTrades`, `poolStats` (approximately 1516–1625).
- Universe, RS, scan orchestration, signal construction, sizing, exposure and correlation: `scan` (approximately 1663–1928).

The application is not yet ready for a safe mechanical extraction. Several behaviors need explicit decisions and regression tests first.

## Findings

### F-01 — Intrabar exit simulation can be optimistic after TP1
Severity: High (backtest validity)

Location: `simExit`, approximately lines 1534–1547.

The loop checks the current stop before TP1. When TP1 is hit, it moves the stop to breakeven, but does not check the same candle's low against the newly moved stop before evaluating TP2. A candle whose high reaches TP1 and whose low later falls through breakeven can therefore be modeled as surviving when the actual intrabar sequence is unknown.

Required correction:
- Define a conservative OHLC execution policy.
- At minimum, if TP1 and the post-TP1 breakeven stop are both inside the same bar, assume the adverse outcome unless lower-timeframe data resolves ordering.
- Add fixtures for stop-only, TP1-only, TP1+breakeven same bar, TP1+TP2 same bar, and gaps through stop/target.
- Apply fees and slippage to each executed tranche and stop exit, not just a flat round-trip approximation.

### F-02 — Regime transition is not a hard gate for new entries
Severity: High (decision consistency)

Location: `regimeTimeline` and `scan`, approximately lines 1031–1041 and 1663–1800.

The scan exposes a `confirmed` flag when the latest raw regime equals the effective regime. However, the subsequent candidate and signal pipeline continues using `effReg` even when `confirmed` is false. Thus new setups can still be evaluated and potentially emitted using the prior effective regime while a new raw regime is awaiting confirmation.

Required decision:
- Decide whether pending regime transitions should block all new entries, reduce size, or permit the previous regime playbook.
- Make that policy explicit in the output reason codes.
- Add a fixture where raw regime changes for fewer than `confirmBars` and verify the chosen behavior.

### F-03 — Market data normalization has no explicit quality gate
Severity: High (input safety)

Location: `series`, approximately lines 999–1009; scan data retrieval around lines 1663–1784.

`series` filters rows by close time but does not itself sort, deduplicate, verify OHLC consistency, detect gaps, reject non-finite values, or report stale data. The current provider may usually return ordered Binance candles, but that assumption is not encoded as a contract.

Required correction:
- Add a normalization/validation layer before indicator preparation.
- Check timestamp monotonicity and uniqueness, expected interval continuity, finite positive OHLC, high/low consistency, non-negative volume, and explicit closed-candle state.
- Critical failures must return `WAIT_DATA` / `BLOCKED`; do not silently compute indicators over malformed data.

### F-04 — Pivot confirmation applies an additional delay
Severity: Medium (signal timing)

Location: `pivotsAll`, `pivUpTo`, and `structureEvents`, approximately lines 994 and 1011–1013 / 1134 onward.

`pivotsAll` only identifies a pivot after its right-side lookahead window exists. `pivUpTo` and `structureEvents` then require the pivot index to be at most `i - k` again. With the default `k=3`, this appears to add another three bars beyond the pivot's own right-side confirmation. This is not lookahead, but it can materially delay BOS/CHoCH and swing recognition.

Required correction:
- Define one canonical pivot availability timestamp/index.
- Use it consistently in live and historical calculations.
- Add tests that prove the pivot becomes available exactly after the intended number of closed candles.

### F-05 — 1H zone-touch logic needs stronger boundary semantics
Severity: Medium (trigger correctness)

Location: `ltfTrigger`, approximately lines 1219–1237.

The touch scan chooses the first 1H candle whose low is at or below the zone's upper boundary. It does not require that the candle's range actually intersects the zone's lower boundary. A deep move below the zone may still be treated as a touch unless the latest close crosses the separate broken-zone threshold.

Required correction:
- Define whether a valid touch requires candle range intersection with the zone, close back inside, or a sweep-and-reclaim.
- Distinguish `TOUCHED`, `BROKEN`, and `RECLAIMED` states.
- Test deep penetration, close below invalidation, reclaim, and stale touch cases.

### F-06 — Backtest coverage and execution assumptions are not yet sufficient for release
Severity: High (research validity)

Location: `backtest`, `backtestSignal`, `simExit`, `statsOf`, approximately lines 1089 onward and 1516–1625.

The current backtest has useful trade statistics and fees, but source inspection shows no complete evidence package for spread, slippage, exchange filters, realistic order fill, funding (not applicable to spot, but fees/spread still matter), chronological holdout, walk-forward robustness, or parameter sensitivity. The broad playbook/regime backtest uses daily series while live SMC setup analysis uses 4H plus 1H context; those results must not be presented as direct validation of the SMC live entry path.

Required correction:
- Keep exploratory backtests labelled informational.
- Build a separate event-driven simulator for the exact production entry/exit contract.
- Add chronological train/validation/out-of-sample and walk-forward reports.
- Report by symbol, regime, volatility bucket, and time period.
- Do not use a positive in-sample PF as a release gate by itself.

### F-07 — Weekly context is aggregated from the available daily series
Severity: Low/Medium (context labeling)

Location: `weeklyContext`, approximately lines 1203–1218.

Weekly bars are aggregated from daily bars in the supplied series. The latest aggregate may represent an incomplete current week (even though its daily component is closed). Weekly trend/resistance should therefore be labeled provisional unless the week is complete.

Required correction:
- Include a `closed` / `provisional` state for weekly context.
- Do not let a partial weekly bar become a hard higher-timeframe confirmation.

## Extraction inventory

### Move to this strategy repository
- Indicator primitives and pure series preparation.
- Regime classification and regime state machine.
- Relative-strength scoring and eligibility calculations (after separating market metadata from UI).
- Swing/pivot and BOS/CHoCH calculations.
- Order-block, FVG, liquidity and zone analysis.
- 1H trigger state machine.
- Setup construction, entry/stop/target calculations.
- Risk sizing, correlation, exposure and portfolio gates.
- Backtest statistics and a corrected event-driven simulator.

### Keep in the application repository
- Binance REST/WebSocket provider and exchange metadata retrieval.
- CoinGecko / macro calendar fetching.
- Local database shim, localStorage, browser persistence and backup/restore.
- UI rendering, chart drawing, navigation, forms and translations.
- Notifications, journal presentation and user interaction.
- Scan scheduling and application orchestration.

### Adapter responsibilities
The app adapter must convert provider responses into normalized immutable snapshots, call a pinned strategy version, validate its response, persist the audit record, and render the result. The strategy engine must not fetch data, access browser APIs, or send alerts.

## Proposed extraction order

1. Implement schema validation and candle-quality checks.
2. Extract indicator and series modules with parity fixtures.
3. Extract regime logic and confirm transition policy.
4. Extract universe and RS logic.
5. Extract structure/SMC primitives and trigger state machine.
6. Extract entry/exit and risk modules.
7. Replace or clearly separate exploratory backtest from production-contract simulator.
8. Wire application adapter only after unit and regression tests pass.

## Release blockers

- F-01, F-02, F-03, and F-06 must be resolved before strategy release.
- F-04 and F-05 must be resolved before treating SMC triggers as validated.
- No live execution is in scope.
- No strategy profitability claim is made by this audit.
