# Strategy research — round 3 results (2026-11-22)

Protocol: [`PROTOCOL-ROUND-3.md`](./PROTOCOL-ROUND-3.md), committed in `9ae075d` before implementation or any run. Report: `round-3/development-TF-R.json`.

**Outcome: TF-R did not qualify** under the pre-registered rule, because development drawdown is 42.2% against a ≤ 20% limit. The round ends with no change. As the protocol requires, the **12 holdout symbols were not used** and stay clean. Nothing is enabled.

## Development portfolio (15 symbols, shared 100k account, 2019-01-01 → 2026-11-22)

| Metric | Result | Selection rule | |
|---|---|---|---|
| Trades | 327 | — | |
| Profit factor | 1.71 | ≥ 1.2 | ✅ |
| Net return | **+303%** | — | |
| Cost stress (20/20 bps): PF / return | 1.62 / +255% | return > 0 | ✅ |
| Positive folds | 5/6 (+28.7, +99.3, −18.9, +32.3, +29.8, +3.4 %) | ≥ 50% | ✅ |
| **Max drawdown (combined equity)** | **42.2%** | ≤ 20% | ❌ |
| Bootstrap P95 drawdown | 31.9% | (gate ≤ 30%) | |

Largest contributors: SOL +90%, BNB +81%, ADA +61%, BTC +47%, DOGE +45% (of initial capital). Weakest: LTC −34%, ATOM −26%, DOT −14%.

## Drawdown diagnosis (verified, not a bug)
- Peak **2021-09-06** (equity 340k) → trough **2023-10-12** (197k): the 2022 crypto bear market and the 2023 chop.
- 75 trades overlap the drawdown: 54 initial-stop losses, 20 trailing-stop exits, 1 signal exit. It's a slow bleed of many ~1% breakout failures, not one blow-up.
- Risk controls worked as designed: the maximum position size at entry was exactly 20.0% of equity. The chandelier stop limits open-profit giveback (see `tests/rule-portfolio.test.js`).

## Comparison with round 2 (same entry)
Round 2 measured isolated per-symbol accounts (worst symbol DD 68.9% on unseen symbols). Round 3 measures the honest combined account. Profitability survives the stricter accounting (PF 1.71, robust to costs), but **correlated breakout failures across crypto in bear markets** produce a deep drawdown at 1% risk per trade.

## What a round 4 could test (requires a new pre-registered protocol)
The remaining problem is bear-market bleed, not giveback. Candidate controls to fix in advance:
- **Market-wide trend filter:** only open new positions while BTC closes above its SMA200, cutting entries during broad bear markets.
- **Lower risk per trade** (e.g. 0.5%). Drawdown scales roughly linearly with risk, so this is a sizing choice, not an edge. It must be declared before testing.
- **Portfolio heat limit:** a cap on the total open risk across positions.

The 12 holdout symbols remain unused and can serve once for a round-4 candidate, followed by forward paper trading.
