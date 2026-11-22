# Strategy acceptance — 2026-11-22

**Decision: REJECT.** The strategy is **not eligible for paper-trading entries**. With `--paper-trading`, the engine keeps entries blocked.

Full report: [`strategy-acceptance-report.json`](./strategy-acceptance-report.json). It contains evidence, per-check results, the trade log, provenance and the dataset fingerprint. Reproduce with:

```
NODE_USE_ENV_PROXY=1 node scripts/build-acceptance-report.mjs --start 2022-01-01T00:00:00Z --end 2026-11-22T00:00:00Z --folds 6
```

## Setup
- BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT; public Binance Spot klines; 2022-01-01 → 2026-11-22.
- Causal replay at every closed H1 bar (42,863 per symbol), using the live screener's lookback windows and engine v0.2.0 after audit fixes #6 and #9. No parameter was tuned on this data.
- Entry at the next H1 open; 1% risk per trade; fees 10 bps + slippage 5 bps per side; one position per symbol; 10,000 per symbol, equal weight.
- Data quality: **PASS**. Each symbol misses one H1 bar (a 1-hour exchange outage), which is within policy.

## Results against the gate

| Check | Result | Threshold | |
|---|---|---|---|
| Out-of-sample trades | 68 | ≥ 100 | ❌ |
| Profit factor | 0.99 | ≥ 1.20 | ❌ |
| Net return (equal weight) | −0.10% | > 0 | ❌ |
| Max drawdown (worst symbol) | 8.2% | ≤ 20% | ✅ |
| Positive walk-forward folds | 1 of 6 (17%) | ≥ 60% | ❌ |
| Trades per regime | 3–24 | ≥ 20 each | ⏳ underpowered |
| Cost stress (20/20 bps): PF / return | 0.58 / −3.2% | ≥ 1.0 / > 0 | ❌ |
| Bootstrap P95 drawdown | 20.7% | ≤ 30% | ✅ |

Walk-forward folds (net return %): 2022: 0 trades; 2022-23: −0.80; 2023-24: −0.87; 2024-25: −0.31; 2025: **+1.75**; 2026: −0.41. Bootstrap probability of loss: 51%.

Per symbol (trades, return %, PF): BTC 22 / +3.1 / 1.25; ETH 13 / +0.9 / 1.13; SOL 3 / −1.8 / 0.14; BNB 18 / −7.6 / 0.25; XRP 12 / +5.0 / 1.93.

## Interpretation
- No edge is measurable after costs: PF ≈ 1.0 at base costs, and it falls to 0.58 when costs double. Results are positive in only one of six periods.
- The sample is small. The daily, weekly and regime gates filter heavily (2022 produced no trades at all), so even a better PF would not reach the 100-trade minimum.
- **Do not cherry-pick symbols** (e.g. keeping only BTC and XRP). Choosing the winners after seeing the results is overfitting and would not be out-of-sample evidence.
- Next steps, if pursued, need new hypotheses that are tested on a holdout before use: a broader universe for sample size, review of the exit model and target placement, and cost-aware filters. Re-run this pipeline after any strategy change.

## Validity checks performed
- The daily-gate replay shortcut is proven exact: identical candidates and reason counts with and without it, in tests and on real BTC data (Oct 2025).
- Candidate-to-trade attrition is explained. Most candidates repeat the same setup while a position is already open (e.g. BTC 116 of 164); 10–15% exceed the 1% entry-drift rule. Relaxing that rule cannot add enough trades to change the decision.
- Limitations are listed in the report: no parameter fitting does not guarantee the rules were designed without hindsight; the drawdown is a worst-symbol bound; OHLC simulation; bootstrap assumptions.
