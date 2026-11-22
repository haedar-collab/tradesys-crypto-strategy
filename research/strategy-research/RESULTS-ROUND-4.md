# Strategy research — round 4 results (2026-11-22)

Protocol: [`PROTOCOL-ROUND-4.md`](./PROTOCOL-ROUND-4.md), committed in `691861b` before implementation or any run. Report: `round-4/development-TF-R2.json`.

**Outcome: TF-R2 did not qualify. It is a narrow miss on drawdown (21.4% vs ≤ 20%).** Per protocol the round ends with no change, and the **12 holdout symbols remain unused**. Nothing is enabled. No parameter is adjusted after the fact to pass the threshold: that would be fitting to the development set.

## Development portfolio (15 symbols, shared 100k, 2019-01-01 → 2026-11-22)

| Metric | Round 3 TF-R | **Round 4 TF-R2** | Selection rule | |
|---|---|---|---|---|
| Trades | 327 | 332 | | |
| Profit factor | 1.71 | **1.79** | ≥ 1.2 | ✅ |
| Net return | +303% | +110.6% | | |
| Cost stress: PF / return | 1.62 / +255% | 1.65 / +92.0% | return > 0 | ✅ |
| Positive folds | 5/6 | 4/6 (+4.5, +38.7, −5.4, +21.8, +26.6, −3.2 %) | ≥ 50% | ✅ |
| **Max drawdown (combined)** | 42.2% | **21.4%** | ≤ 20% | ❌ (narrow) |
| Bootstrap P95 drawdown | 31.9% | **18.6%** | (gate ≤ 30%) | ✅ |

The informational acceptance gate on development is REJECT on max drawdown only; regime sample size is pending (bearish groups have fewer than 20 trades).

## Drawdown diagnosis (verified)
- Same window as round 3, peak 2021-09-06 → trough 2023-08-07, but **half as deep** (166k → 131k, −21.4%). Of 62 overlapping trades, 45 are initial stops.
- Risk controls held exactly: 0.500% initial risk per trade, heat cap enforced, BTC filter active.
- The market filter and lower risk roughly halved drawdown while **raising** profit factor (1.71 → 1.79). Returns fell with the smaller position size, as expected.

## Declared caveat
The 0.5% risk level was chosen after seeing the round-3 drawdown (declared in the protocol). Development results therefore partly reflect that choice; only unseen data can confirm them.

## Where this leaves the research
Across rounds 2–4 the trend-following edge is **consistent**: PF 1.6–1.8 on the development portfolio, PF 3.15 on unseen symbols in round 2, and robust to doubled costs. The binding constraint is the 2022 bear-market drawdown, and TF-R2 brings it to about the 20% limit.

Options for the owner:
1. **Stop here.** Keep the system as a monitor and screener.
2. **Forward paper observation of TF-R2.** Integrate the daily TF-R2 rules into the PAPER_ONLY engine and observe for several months on live data. This creates genuinely new out-of-sample evidence without consuming the holdout. It needs a separate, reviewed integration; the acceptance gate is unchanged.
3. **Round 5 with a new pre-registered protocol.** This must not be a parameter nudge just to cross 20% (e.g. 0.4% risk) on the same development data, which would be overfitting. It needs a materially different risk idea, judged once on the 12 unused holdout symbols.
