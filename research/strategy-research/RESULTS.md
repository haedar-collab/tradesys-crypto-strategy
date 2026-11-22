# Strategy research — round 1 results (2026-11-22)

Protocol: [`PROTOCOL.md`](./PROTOCOL.md), pre-registered in commit `90f17c5` before any variant ran. Reports: `dev/V0.json` … `dev/V3.json`.

**Outcome: no variant qualified under the pre-registered rule.** The round ends with **no strategy change**. As the protocol requires, the holdout set (10 unseen symbols) was **not** used, so it stays clean for a future round. The strategy remains REJECTED and the paper engine keeps entries blocked.

## Development set (BTC, ETH, SOL, BNB, XRP; 2022-01-01 → 2026-11-22)

| Variant | Trades | PF | Net return | Max DD | Stress PF / return | Positive folds | Bootstrap P95 DD | Qualifies |
|---|---|---|---|---|---|---|---|---|
| V0 baseline | 68 | 0.99 | −0.10% | 8.2% | 0.58 / −3.2% | 1/6 | 20.7% | no |
| V1 unconfirmed regime allowed | 70 | 1.02 | +0.17% | 8.2% | 0.59 / −3.1% | 1/6 | 19.5% | no |
| V2 single exit at TP2 | 68 | 0.74 | −2.40% | 8.1% | 0.50 / −4.5% | 1/6 | 28.9% | no |
| V3 minRR 2.0 | 57 | 1.10 | +0.60% | 7.7% | 0.66 / −2.2% | 1/6 | 16.1% | no |

Rule: ≥ 40 trades **and** positive stressed return **and** ≥ 50% positive folds. Every variant fails the stressed-return and fold criteria.

V0 reproduces the original acceptance report exactly, which confirms the pipeline is deterministic.

## What this tells us (descriptive, not a new hypothesis test)
- **V1:** the regime-confirmation gate is not the sample-size bottleneck (+2 trades). Most hours are blocked earlier by the weekly/daily bias gates.
- **V2:** scaling out and moving to breakeven *helps* this strategy. Holding for TP2 lowers PF from 0.99 to 0.74 and worsens tail risk.
- **V3:** the higher reward-to-risk improves PF slightly (1.10) but loses trades, and it is still negative under cost stress.
- In every variant only one of six periods (2025) is positive, and 2022 produces no trades at all. The weakness is consistent across periods, not a tuning detail.

## Recommendation
- Keep the strategy **REJECTED**. Do not iterate further on small parameter changes of the same rules on the same data: each extra attempt raises the chance of a false positive.
- A next round should start from a **new protocol** with a materially different hypothesis (e.g. a different entry concept or holding horizon). It can use the still-unseen holdout symbols once, plus forward paper observation.
