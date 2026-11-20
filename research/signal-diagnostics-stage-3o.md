# Stage 3O — Strategy Signal Diagnostics

The diagnostic runner rebuilds the causal MTF context at every supplied evaluation timestamp, then records upstream Weekly/Daily bias, raw/effective Daily regime, confirmation state, 4H structure, and the first blocking strategy gate.

This distinguishes a genuine market filter from upstream context/warm-up failures. The first blocking gate follows the existing engine's precedence; it is not a count of every possible downstream rejection. The runner is read-only and does not change thresholds or strategy rules.

No fills, fees, slippage, trade returns or portfolio results are inferred.
