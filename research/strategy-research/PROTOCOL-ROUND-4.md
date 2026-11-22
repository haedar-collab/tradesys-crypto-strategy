# Strategy research protocol — round 4 (pre-registered 2026-11-22)

Committed **before** implementation or any run. Results go in `RESULTS-ROUND-4.md`; this file is not edited afterwards.

## Motivation (from round 3)
TF-R was profitable and cost-robust on the 15-symbol development portfolio (PF 1.71, +303%, 5/6 positive folds). It failed only on drawdown: 42.2% on combined equity, driven by correlated breakout failures in the 2022 bear market (54 initial-stop losses).

## Candidate TF-R2 (one candidate, no variants)
Everything as TF-R in round 3 (entry, 2×ATR initial stop, 3×ATR chandelier, Donchian-20 exit, 20% per-position cap, shared 100k account, no leverage, alphabetical priority, costs), plus:
1. **Market filter:** a new entry is allowed only if, on the signal day, **BTCUSDT close > BTCUSDT SMA200**, computed on BTC daily bars ≤ that day. If BTC has no bar that day, the entry is blocked. Exits are unaffected.
2. **Risk per trade 0.5%** of marked equity (round 3: 1%).
3. **Portfolio heat cap 5%:** the sum of open positions' *initial* risk (qty × (entry fill − initial stop)) plus the new trade's risk must be ≤ 5% of marked equity. A new trade is downsized to fit and skipped if less than 0.1% of equity of risk budget remains.

### Declared limitation
Item 2 was chosen **after** seeing the round-3 drawdown on the development set. Drawdown scales roughly with risk per trade, so a development pass partly reflects that choice. The **holdout set is therefore the decisive test**.

## Data
- **Period:** 2019-01-01 → 2026-11-22, daily bars.
- **Development set:** the same 15 symbols as round 3. BTCUSDT daily bars also drive the market filter.
- **Holdout set (still never used):** BCHUSDT, NEOUSDT, VETUSDT, ALGOUSDT, XTZUSDT, HBARUSDT, FILUSDT, NEARUSDT, UNIUSDT, AAVEUSDT, SANDUSDT, ZECUSDT. BTCUSDT is fetched for the filter only and is not traded. Symbols without data are dropped and reported, with no replacement.
- 6 chronological folds, each from fresh capital; BTC daily regime groups; block bootstrap (block 5, 2,000 runs, seed 42); unchanged data-quality policy.

## Selection rule (development set; same as round 3)
- profit factor ≥ 1.2;
- positive net return under cost stress (20/20 bps);
- max drawdown on combined equity ≤ 20%;
- ≥ 50% positive folds.

## Holdout test (once)
If TF-R2 qualifies, evaluate it **once** on the holdout portfolio with the **unchanged acceptance gate**. The decision is final. An ACCEPT would only make TF-R2 a candidate for controlled **paper** trading, which requires a separate, reviewed integration. Live trading stays out of scope.
