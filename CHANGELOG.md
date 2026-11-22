# Changelog

## Unreleased — 2026-11-22 Render restart fix

- Fix: `npm run start:dashboard` now `exec`s Node. Previously `npm` did not forward SIGTERM through `sh -c`, so every Render restart or deploy killed Node without a clean shutdown and left the ledger lock behind (the 01:43 UTC deploy failed with "ledger is locked").
- Fix: new exclusive-volume lock policy (`--exclusive-volume`, automatic when `RENDER=true`). A lock created before the current container started is reclaimed, because a Render disk can be attached to only one instance. This also recovers locks in the pre-fix format and locks from previous instance hostnames. The default policy elsewhere is unchanged (fail-closed).

## Unreleased — 2026-11-22 audit remediation

- Fix: a rejected pre-trade risk check (e.g. an oversized BUY) no longer latches the session-wide kill switch or moves peak/day-start baselines. Actual equity is evaluated first; the projected post-trade portfolio is checked with the side-effect-free `riskMonitor.preview()`.
- Fix: an order interrupted before a durable fill no longer blocks activation forever. Operators record a hash-chained `OPERATOR_REVIEW_RESOLVED` event (`npm run paper:resolve-review`); the recovery audit verifies it and reports INFO instead of REVIEW. Forged, duplicate or out-of-order resolutions fail the audit.
- Fix: a ledger lock left by a crashed process (OOM, SIGKILL, container restart with PID reuse) is reclaimed when the owner is provably dead (hostname + Linux boot id + PID + process start time). Live, foreign-host, legacy and malformed locks still fail closed.
- Fix: a failed ledger write/fsync rolls the file back to the last acknowledged record and poisons the handle, so a later append can no longer extend a torn or unacknowledged hash chain.
- Fix: the 4H liquidity-sweep entry trigger now reaches the SMC decision gate (`toSweepEvidence`); previously a boolean was passed where `{ confirmed: true }` was expected, disabling that trigger. Signal frequency changes, so re-run prior validation reports.
- Fix (#7): the dashboard can no longer hang on Binance. REST requests time out (`timeoutMs`, default 10 s, plus optional caller `signal`); feed/strategy providers are bounded (`providerTimeoutMs`, default 2.5 s) and degrade fail-closed to `DISCONNECTED` / `PROVIDER_TIMEOUT`; the screener serves its cached result while refreshing in the background (stale-while-revalidate), shows `LOADING` on a slow first scan, labels results older than `staleAfterMs` as `STALE` without surfacing their signal, and backs off after failures.
- Fix (#10): SELL exits no longer require strategy acceptance, so a position can always be reduced or closed (still bounded by held quantity, quote freshness and the session risk gate). BUY entries still require `ACCEPT`.
- Improve: remote-binding startup errors name the unmet requirement (e.g. password length) without echoing secrets.

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


- Added marked-equity drawdown checks and terminal marked-equity reporting to single-symbol and aligned portfolio simulators.
- Fixed single-symbol drawdown admission when a stop closes on the entry bar.
- Added single-symbol/one-symbol portfolio parity coverage for open positions, partial TP1, gap-through-stop fills and completed trades.
- Latest GitHub Actions CI: 113 tests passed, 0 failed. Research-only status remains; broader risk-state parity and out-of-sample validation are not complete.

- Unified single-symbol and portfolio backtests on the same hysteretic drawdown state machine, including reduced-risk sizing and a recovery threshold derived safely from lower custom drawdown limits.
- Added single-/one-symbol portfolio parity test for drawdown-reduction sizing after a realized loss.
- Latest GitHub Actions CI: 114 tests passed, 0 failed.

- Added multi-position simultaneous-loss stress tests proving that combined realized losses trigger the portfolio drawdown block before a subsequent candidate can enter, and that combined open-position losses are marked before entry admission.
- Latest GitHub Actions CI: 116 tests passed, 0 failed (run #324).

- Added a multi-position recovery test: the drawdown block persists through a partial rebound and allows a new entry only after the configured recovery threshold is reached.
- Latest GitHub Actions CI: 117 tests passed, 0 failed (run #341).

- Added multi-asset correlation stress tests for negative correlation, multiple active positions, threshold-boundary behavior, and fail-closed handling of incomplete return history.
- Latest GitHub Actions CI: 121 tests passed, 0 failed (run #351).
