# Stage 3Q — Filter Gate Analysis

This read-only report counts each observable blocker independently and also counts the first blocker in the engine's ordered evaluation sequence.

Independent blocker counts overlap; they are not additive. First-blocker counts are mutually exclusive but conceal later blockers. The module intentionally does not disable gates, generate counterfactual entries, or modify strategy parameters.

A true ablation study requires rerunning the full causal engine and event-driven simulator under pre-registered alternative configurations on training folds only. Untouched holdout must remain sealed until configuration selection is complete.

No profitability claim is possible without trade fills, fees, slippage, and portfolio-level accounting.
