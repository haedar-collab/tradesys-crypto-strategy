# Backtest Accounting Audit — 2026-11-20

## Scope

Static review of `src/backtest/event-driven.js` and `src/backtest/portfolio.js` on `foundation/v1-contract`. This is a code-level audit, not a runtime execution or profitability assessment.

## Findings and remediation status

The original findings below were addressed in code on `foundation/v1-contract` with marked-equity accounting, per-bar drawdown checks, and terminal marked equity. The implementation has now passed GitHub Actions CI on the latest branch revision (121 tests, 0 failures). The parity coverage includes terminal marked equity, partial TP1 open-position accounting, gap-through-stop fills, completed-trade PnL and single-/one-symbol shared hysteretic drawdown-reduction sizing. Multi-position simultaneous-loss stress tests now verify that combined realized losses block a subsequent candidate and that combined open-position losses are marked before entry admission. Broader recovery-state parity, all fee/slippage configurations and terminal liquidation remain open.

### BTA-001 — Drawdown is calculated from realized closed-trade equity only

**Severity:** High — implementation and baseline regression verified; broader edge-case validation pending

Both simulators update peak equity and maximum drawdown only when a position closes. The portfolio simulator also evaluates its drawdown gate using this realized-only equity and peak.

**Risk:** Open positions can incur substantial unrealized losses without reducing the equity series used by the drawdown guard. New entries may continue to be admitted while the live marked portfolio is already beyond its intended drawdown threshold. Reported maximum drawdown can materially understate portfolio risk.

**Required change:**
- Mark every open position to market at each common bar close.
- Calculate equity as cash/realized equity plus unrealized PnL, with consistent treatment of entry/exit fees and remaining quantity.
- Track peak and drawdown from the marked equity curve.
- Feed the marked drawdown state into the entry gate before admitting new positions.
- Preserve realized-only metrics as a separately named diagnostic, not as the primary risk-control basis.

### BTA-002 — Open positions at the end of the sample are not included in ending equity

**Severity:** High

The single-symbol simulator returns `endingEquity` based on closed trades only and reports an open position separately. The portfolio simulator does the same while returning `openPositions` separately.

**Risk:** A sample ending with an open profitable or losing position can produce a misleading ending equity and net return. Different strategies with different holding periods are not comparable if terminal exposure is omitted.

**Required change:**
- Report both `realizedEndingEquity` and `markedEndingEquity`.
- Include terminal unrealized PnL and estimated liquidation fees/slippage in marked equity.
- Do not silently force-close positions unless the test configuration explicitly requests terminal liquidation.
- Clearly state whether headline return includes open-position mark-to-market.

### BTA-003 — Single-symbol backtest has no drawdown admission guard

**Severity:** Medium — implementation and entry-bar regression verified; full drawdown-state parity pending

The single-symbol simulator has no peak-to-trough drawdown state machine, unlike the portfolio simulator.

**Risk:** Single-symbol research results cannot be compared with portfolio risk behavior and may continue taking entries after a configured loss limit should have blocked new trades.

**Required change:**
- Reuse the same drawdown state machine in single-symbol and portfolio simulation.
- Add parity tests proving identical drawdown transitions for equivalent equity paths.

## Acceptance tests required

1. An open position that moves adversely beyond the drawdown threshold must reduce marked equity and block subsequent entries.
2. An open position that moves favorably must increase marked equity without realizing PnL.
3. A dataset ending with an open position must report realized and marked equity separately.
4. Terminal liquidation mode must charge exit fee and adverse slippage exactly once.
5. Drawdown recovery must follow configured hysteresis and must not reset from realized-only equity.
6. Single-symbol and one-asset portfolio runs with identical inputs must produce equivalent marked equity, drawdown state, and trade accounting.
7. Partial exits must reduce remaining quantity before mark-to-market PnL is calculated.
8. No future bar may affect a prior bar's marked equity, drawdown state, or entry decision.

## Release decision

Backtest outputs remain research-only until the current branch passes CI and the acceptance tests below are verified. The implementation has passed the current 113-test CI suite. Remaining acceptance tests—especially full drawdown-state parity and terminal liquidation accounting—must still pass before release. No profitability claim follows from these code changes.


## Multi-position stress increment — 2026-11-20

- Added deterministic tests with two concurrent positions losing together and a third candidate due for entry. The portfolio blocks the third entry after combined realized losses breach the drawdown limit.
- Added a second test where two open positions produce combined marked losses; the candidate entry is blocked before a realized exit occurs.
- CI run #324 passed: 116 tests, 0 failures. This verifies these specific stress paths only; it is not a comprehensive Monte Carlo, walk-forward, or market-impact validation.


- Added a deterministic multi-position hysteresis test with two open positions: a partial equity rebound above the recovery threshold must keep the portfolio blocked, while a later full recovery unlocks the next candidate. CI run #341 passed: 117 tests, 0 failures.


## Correlation stress increment — 2026-11-20

- Tested negative correlation against a positive-correlation cap, a highly correlated candidate against multiple active positions, exact threshold boundary behavior, and fail-closed behavior when one active asset has incomplete aligned return history.
- CI run #351 passed: 121 tests, 0 failures. These are deterministic unit tests, not evidence of real-world diversification or stable correlations during market stress.
