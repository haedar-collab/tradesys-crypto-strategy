# Strategy research protocol — round 3 (pre-registered 2026-11-22)

Committed **before** implementation or any run. Results go in `RESULTS-ROUND-3.md`; this file is not edited afterwards.

## Motivation (from round 2)
The TF entry (Donchian 55 breakout above SMA200) was profitable and cost-robust on unseen symbols, but failed the gate on **risk**: open-profit giveback (DOGE 2021: 74% of open profit returned), and drawdown was measured on isolated per-symbol accounts. Round 3 tests **one** candidate that adds risk controls fixed in advance. There are no variants and no parameter search.

## Candidate TF-R (daily bars, long-only spot, shared portfolio)
- **Entry:** unchanged from round 2. At close *i*: close > highest high of the previous 55 days and close > SMA200; fill at the next open.
- **Initial stop:** entry fill − 2 × ATR14(*i*).
- **Trailing stop (new):** ATR chandelier. After each close, stop = max(previous stop, highest close since entry − 3 × ATR14). It applies intrabar from the next bar; a gap through the stop fills at the open.
- **Signal exit:** unchanged. Close < lowest low of the previous 20 days → exit at the next open.
- **Portfolio accounting (new):** one shared account of 100,000 for all symbols.
  - Size each entry to 1% of current marked equity at the initial stop.
  - Cap each position at **20% of marked equity at entry**.
  - Total cost of open positions ≤ available cash (spot, no leverage).
  - When cash is short on the same day, process entries in alphabetical symbol order and skip those that don't fit.
- **Costs:** 10 bps fee + 5 bps slippage per side; stress at 20 + 20 bps.
- **Drawdown:** measured on the **combined marked equity** at daily closes.

## Data
- **Period:** 2019-01-01 → 2026-11-22; indicators warm up from each symbol's listing.
- **Development set (seen in round 2 for TF):** BTC, ETH, SOL, BNB, XRP, ADA, DOGE, LINK, LTC, TRX, DOT, AVAX, ATOM, ETC, XLM (all USDT).
- **Holdout set (never used in any round; fixed now by long listing history and liquidity, without looking at results):** BCHUSDT, NEOUSDT, VETUSDT, ALGOUSDT, XTZUSDT, HBARUSDT, FILUSDT, NEARUSDT, UNIUSDT, AAVEUSDT, SANDUSDT, ZECUSDT.
  - A symbol without Binance daily data for the period is dropped and reported. No replacement is chosen after seeing data.
- 6 chronological folds, each starting from fresh capital; BTC daily regime groups; block bootstrap (block 5, 2,000 runs, seed 42) on trade returns relative to portfolio equity; unchanged data-quality policy.

## Selection rule (development set)
TF-R goes to the holdout only if, on the development portfolio, it has:
- profit factor ≥ 1.2;
- positive net return under cost stress;
- max drawdown ≤ 20%;
- ≥ 50% positive folds.

## Holdout test (once)
Evaluate on the holdout portfolio with the **unchanged acceptance gate** (default thresholds). The decision is final for this round, with no re-tuning. Even an ACCEPT only grants controlled **paper** trading, and live trading stays out of scope. An integration into the paper engine would be a separate, reviewed change.
