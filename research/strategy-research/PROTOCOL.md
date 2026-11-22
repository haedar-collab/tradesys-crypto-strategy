# Strategy research protocol — round 1 (pre-registered 2026-11-22)

Written and committed **before** any variant below was run, to limit overfitting and multiple-testing bias. Results are appended in `RESULTS.md` without editing this file.

## Context
The baseline (engine v0.2.0) was **REJECTED** by the acceptance gate (`research/acceptance/`): 68 trades, PF 0.99, 1/6 positive folds, cost stress PF 0.58. Its results on BTC, ETH, SOL, BNB and XRP for 2022–2026 have therefore already been seen.

## Data split
- **Development set (already seen):** BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT; 2022-01-01 → 2026-11-22.
- **Holdout set (never evaluated before this protocol):** ADAUSDT, DOGEUSDT, LINKUSDT, LTCUSDT, TRXUSDT, DOTUSDT, AVAXUSDT, ATOMUSDT, ETCUSDT, XLMUSDT; same period. This is a cross-asset holdout: the 10 symbols are fixed now, by liquidity and long listing history, without looking at their results.
- Final arbiter beyond this round: forward paper trading on live data.

## Hypotheses (structural reasons, not fitted to trades)
| Id | Change | Rationale |
|---|---|---|
| V0 | Baseline (no change) | Reference |
| V1 | Do not require a *confirmed* daily regime; still block `Downtrend` | `MARKET_REGIME_UNCONFIRMED` is a frequent gate and makes the sample too small (68 < 100 trades). |
| V2 | Exit model `SINGLE_TP2`: fixed stop, exit 100% at TP2; no partials and no move to breakeven | Moving the stop to breakeven after TP1 turns many winners into fee-paying scratches, and partial exits pay more fees. |
| V3 | `minRR = 2.0` (was 1.5), both for the plan and the live entry check | A larger reward-to-risk lowers the share of fixed costs per trade (cost stress PF was 0.58). |

No other variants, parameter values or combinations are run in this round.

## Selection rule (fixed in advance)
On the **development set only**, select the variant with the highest profit factor among variants that have:
- ≥ 40 trades;
- a positive net return under cost stress (20/20 bps);
- ≥ 50% positive folds.

If no variant qualifies, the round ends with **no change** and the baseline stays REJECTED.

## Holdout test (run once)
The selected variant is evaluated **once** on the holdout set with the unchanged acceptance gate (`evaluateStrategyAcceptance`, default thresholds). Its decision is final for this round: no re-tuning after seeing holdout results. A later round must start from a new protocol.

## Fixed settings (all variants)
Causal replay at every closed H1 bar with the live screener lookbacks; entry at the next H1 open; 1% risk; 10 bps fee + 5 bps slippage (stress 20/20); 6 chronological folds; BTC daily regime groups; block bootstrap (block 5, 2,000 runs, seed 42); data-quality policy unchanged.
