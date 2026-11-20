# Stage 3R — Controlled Strategy Ablation

## Method
Each configuration is passed to a scenarioBuilder that must rebuild causal signals from the same training-fold market data. Every generated signal set is evaluated by the same event-driven or portfolio backtest runner.

## Required scenarios
- Baseline: all production gates enabled.
- Single-gate ablations: remove exactly one gate at a time in research configuration.
- Optional pre-registered combinations only after single-gate comparisons.

## Controls
- Training fold only; do not pass untouched holdout data to this harness.
- Rebuild indicators, MTF context, and signals for every scenario; never reuse baseline signals.
- Keep capital, risk sizing, fees, slippage, execution rules, and market data fixed.
- Report net return, marked-equity maximum drawdown, trade count, win rate, profit factor, and ending equity.
- Use identical simulator implementation and assumptions for all scenarios.

## Holdout discipline
Untouched holdout remains sealed until configurations and conclusions are frozen. The harness accepts trainingInput only and has no holdout parameter. Unit tests do not imply out-of-sample profitability.
