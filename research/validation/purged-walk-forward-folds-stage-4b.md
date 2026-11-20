# Stage 4B — Purged Walk-Forward Fold Planner

## Purpose
Generate reproducible expanding or rolling chronological walk-forward windows for use with the existing runWalkForward engine.

## Contract
- Indices are zero-based and end-exclusive.
- Training always precedes test data.
- A configurable exclusion gap separates training end from test start.
- The gap is explicitly recorded as purgeBars + embargoBars.
- Expanding mode begins training at index zero; rolling mode maintains a fixed training length.
- Test windows advance by stepBars and never exceed barCount.
- The planner is deterministic and does not inspect strategy performance.

## Important methodological boundary
This planner does not infer the correct purge or embargo length. The researcher must set it to at least the maximum label horizon, trade holding overlap, or other dependency window relevant to the strategy. The configured embargo is implemented as part of the pre-test exclusion gap for each fold; it is not a general guarantee against every form of serial dependence or leakage.

## Integration
Pass plan.folds to runWalkForward as windows. The existing walk-forward runner still performs candidate selection on each training slice and evaluates the selected candidate on the later test slice.

## Tests
Covers expanding and rolling folds, chronological ordering, explicit gaps, insufficient history, and invalid configuration.
