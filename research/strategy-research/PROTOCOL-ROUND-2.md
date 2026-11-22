# Strategy research protocol — round 2 (pre-registered 2026-11-22)

Written and committed **before** any round-2 strategy was implemented or run. Results go in `RESULTS-ROUND-2.md`; this file is not edited afterwards.

## Why new concepts
Round 1 showed that the SMC multi-timeframe strategy lacks an edge after costs, and that small parameter changes do not fix it. Round 2 tests two **different, well-known rule families** with textbook parameters fixed in advance. No parameter is chosen from data.

## Strategies (daily bars, long-only spot, one position per symbol)
Shared definitions:
- SMA = simple moving average of close.
- ATR14 = Wilder ATR(14).
- RSI2 = Wilder RSI(2).
- Indicators at bar *i* use bars ≤ *i* only.
- Signals are evaluated on the **daily close**. Entries and signal exits are filled at the **next daily open**.

### TF — Donchian breakout with trend filter (Turtle-style)
- **Entry** at close *i*: close > highest high of the previous 55 days **and** close > SMA200.
- **Initial stop:** entry fill − 2 × ATR14(*i*). Fixed for the life of the trade, and checked intrabar from the entry bar on.
- **Exit** at close *j*: close < lowest low of the previous 20 days.

### MR — RSI(2) pullback in an uptrend (Connors-style)
- **Entry** at close *i*: close > SMA200 **and** RSI2 < 10.
- **Exit** at close *j*: close > SMA5 **or** 10 daily bars held (time stop).
- **Catastrophe stop:** entry fill − 3 × ATR14(*i*), checked intrabar.

### Shared execution
- Size to 1% equity risk at the stop; notional ≤ equity (no leverage).
- 10 bps fee + 5 bps slippage per side; stress test at 20 + 20 bps.
- A stop gapped through at the open fills at the open.
- Marked-to-market drawdown at daily closes.

## Data split
- **Period:** 2019-01-01 → 2026-11-22. Indicators warm up from each symbol's full listing history.
- **Development set:** BTCUSDT, ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT. These symbols were seen in round 1, but only for the SMC strategy.
- **Holdout set (still unused):** ADAUSDT, DOGEUSDT, LINKUSDT, LTCUSDT, TRXUSDT, DOTUSDT, AVAXUSDT, ATOMUSDT, ETCUSDT, XLMUSDT.
- 6 chronological folds; BTC daily regime groups; block bootstrap (block 5, 2,000 runs, seed 42); unchanged data-quality policy (daily bars).

## Selection rule (fixed in advance, per strategy, development set only)
A strategy qualifies for the holdout if it has:
- ≥ 30 trades (daily systems trade less than H1 systems);
- a positive net return under cost stress;
- ≥ 50% positive folds.

## Holdout test (once per qualifying strategy)
Each qualifying strategy is evaluated **once** on the 10 holdout symbols with the unchanged acceptance gate (`evaluateStrategyAcceptance`, default thresholds). Because two strategies may be tested, a pass is only taken at face value if it also holds under cost stress, which the gate already requires. Nothing is re-tuned after the holdout. If neither strategy qualifies or passes, the round ends with no change.
