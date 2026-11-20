# Stage 3O-1 — Bias Classification Component Audit

## Purpose
This read-only audit decomposes the existing Weekly/Daily bias classifier into structure-trend and EMA-spread components. It is intended to explain persistent Neutral or Mixed labels before any strategy-rule change.

## Current production rule mirrored
- Bullish: structure event trend > 0 and EMA50 > EMA200.
- Bearish: structure event trend < 0 and EMA50 < EMA200.
- Neutral: structure event trend is exactly 0.
- Mixed: non-zero structure trend disagrees with EMA50/EMA200 ordering.
- Missing evidence: Neutral with an explicit insufficient-evidence reason.

## Output
For Weekly and Daily, report evaluated rows, resulting bias counts, reason counts, and signs of:
- structure trend;
- EMA50 minus EMA200;
- close minus EMA50;
- close minus EMA200.

## Safety and interpretation
This module does not change entry rules, thresholds, indicators, or strategy behavior. It reproduces the current classifier so diagnostics can identify whether Neutral is caused by a zero structure trend, missing values, or disagreement. A correct implementation is not evidence that the classifier is predictive or profitable.

## Validation
Run: `node --test tests/bias-classification-audit.test.js`
