# Backtest Accounting Audit — 2026-11-20

## Scope

Static review of `src/backtest/event-driven.js` and `src/backtest/portfolio.js` on `foundation/v1-contract`. This is a code-level audit, not a runtime execution or profitability assessment.

## Findings

### BTA-001 — Drawdown is calculated from realized closed-trade equity only

**Severity:** High

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

**Severity:** Medium

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

Backtest outputs remain research-only until BTA-001 through BTA-003 are fixed and the acceptance tests pass. Existing unit-test success does not cover these accounting limitations.
