# Strategy research — round 2 results (2026-11-22)

Protocol: [`PROTOCOL-ROUND-2.md`](./PROTOCOL-ROUND-2.md), committed in `f57edb7` before implementation or any run. Reports: `round-2/development-TF.json`, `round-2/development-MR.json`, `round-2/holdout-TF.json`.

**Outcome: REJECT for both strategies.**
- MR did not qualify on development.
- TF qualified and was tested **once** on the 10 holdout symbols. It is **profitable and cost-robust out of sample**, but it **fails the acceptance gate on risk**: drawdown, bootstrap drawdown and positive-fold ratio.

Nothing is enabled. The paper engine keeps entries blocked.

## Development set (BTC, ETH, SOL, BNB, XRP; 2019-01-01 → 2026-11-22; daily)

| Strategy | Trades | PF | Net return | Max DD | Stress PF / return | Positive folds | Qualifies |
|---|---|---|---|---|---|---|---|
| TF Donchian 55/20 | 91 | 6.00 | +70.6% | 23.8% | 5.66 / +68.7% | 5/6 | **yes** |
| MR RSI(2) | 317 | 1.14 | +1.1% | 3.4% | 0.89 / −0.9% | 4/6 | no (stressed return < 0) |

## Holdout set: TF only, run once (ADA, DOGE, LINK, LTC, TRX, DOT, AVAX, ATOM, ETC, XLM)

| Gate check | Result | Threshold | |
|---|---|---|---|
| Trades | 191 | ≥ 100 | ✅ |
| Profit factor | 3.15 | ≥ 1.20 | ✅ |
| Net return (equal weight) | +37.8% | > 0 | ✅ |
| Max drawdown (worst symbol) | **68.9%** (DOGE) | ≤ 20% | ❌ |
| Positive folds | 3/6 | ≥ 60% | ❌ |
| Trades per regime | 6–129 | ≥ 20 each | ⏳ |
| Cost stress: PF / return | 3.01 / +36.6% | ≥ 1.0 / > 0 | ✅ |
| Bootstrap P95 drawdown | 40.5% | ≤ 30% | ❌ |
| Data quality | PASS | PASS | ✅ |

Folds (trades, net %): 2019: 23 / −0.85; 2020-21: 50 / **+29.2**; 2021-22: 26 / −1.67; 2023: 47 / +3.26; 2024-25: 29 / +6.85; 2025-26: 25 / −1.63.

## Validity checks
- **TF trades audited on BTC:** every entry signal was re-verified against raw data (close above the prior 55-day high and above SMA200; next-open fill). Losses are about −1% of equity each (stop working); profit comes from a few long trends.
- **DOGE 68.9% drawdown verified as real**, not a bug: entered at $0.0057 in Jan 2021, close peaked at $0.69, exited on the 20-day low at $0.18. The position grew to dominate the account and 74% of the open profit was given back.
- **Causality and execution semantics** are covered by `tests/rule-strategies.test.js`.

## Interpretation
- **TF has a real, cost-robust edge across 15 symbols** (PF 6.0 on development, 3.15 on unseen symbols, nearly unchanged under doubled costs). Its weakness is **risk shape**, not profitability:
  - returns are concentrated in a few bull legs (2020–21);
  - large open profits are given back;
  - several periods are flat or slightly negative.
- **MR's edge is too thin for crypto trading costs:** PF 1.14 falls to 0.89 under stress.
- The holdout symbols are **now used** for TF. Any follow-up needs a **new** out-of-sample source, e.g. other Binance symbols not used so far or forward paper observation.

## Possible round 3 (requires a new pre-registered protocol)
Keep the TF entry and add **risk controls** fixed in advance, for example:
- cap position value at a fixed share of equity, or use volatility-targeted sizing;
- a profit-protecting trailing exit (e.g. ATR chandelier);
- portfolio-level drawdown measured on the combined equity curve rather than the worst single symbol.

Evaluate on a fresh symbol set, then forward paper trading.
