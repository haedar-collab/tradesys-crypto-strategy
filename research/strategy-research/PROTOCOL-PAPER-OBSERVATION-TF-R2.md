# Forward paper observation protocol — TF-R2 (pre-registered 2026-11-22)

Committed **before** the observation engine was implemented. Approved by the owner on 2026-11-22. Reviews are appended in `PAPER-OBSERVATION-TF-R2-LOG.md`; this file is not edited afterwards.

## Purpose
TF-R2 narrowly missed the development drawdown rule in round 4 (21.4% vs ≤ 20%) and was **not accepted** by the acceptance gate. The owner chose **forward paper observation** to gather genuinely new out-of-sample evidence on live data. This involves no real money and does not use the 12-symbol holdout.

This is an **observation** of an *unaccepted* strategy. The ledger therefore records it explicitly as such (`observationStrategy` in the immutable session header). It must never be presented as an accepted strategy, and it does not authorize live trading.

## Strategy (exactly the round-4 TF-R2 rules)
- **Universe:** BTC, ETH, SOL, BNB, XRP, ADA, DOGE, LINK, LTC, TRX, DOT, AVAX, ATOM, ETC, XLM (USDT, Binance Spot). Each signal is evaluated on its own symbol's closed daily candles.
- **Entry:** close > highest high of the previous 55 days **and** close > SMA200 **and** BTCUSDT close > BTCUSDT SMA200 on the signal day.
- **Initial stop:** entry fill − 2 × ATR14 (signal day).
- **Trailing stop:** highest close since entry − 3 × ATR14, ratcheting up only.
- **Signal exit:** close < lowest low of the previous 20 days.
- **Sizing:**
  - 0.5% of equity at risk per trade, where equity is marked at the **previous daily close**, exactly as in the simulator;
  - each position ≤ 20% of equity; total initial risk (heat) ≤ 5% (downsize to fit; skip below 0.1%);
  - cash-limited, no leverage; alphabetical priority on the same day.
- **Paper account:** 100,000 USDT on a **dedicated ledger**. Fees 10 bps + slippage 5 bps per side (broker defaults).

## Execution model (live)
- The daily cycle runs at the first engine tick after 00:00 UTC, once yesterday's daily candle is closed.
  - Signal exits are executed first, then entries, both at the live bookTicker quote.
  - **Execution window:** within 6 hours after 00:00 UTC. A missed window is logged as `MISSED_EXECUTION_WINDOW` and that day's orders are skipped, so actions never drift away from the "next open" rule.
- **Stops are monitored on every tick** against the live best bid. The simulator uses the daily low instead; the difference is logged as fill-price deviation, not as a parity violation.
- **Session risk configuration** (immutable ledger header): `maxDrawdownPct 20`, `dailyLossLimitPct 6`, `maxExposurePct 100`. A latched kill switch blocks new entries; exits continue.

## Parity requirement
Given the same daily candles, the engine's **decisions** must match the research simulator `runRulePortfolioBacktest(…, TF_R2)`:
- which symbols are entered or exited, on which day, and for which reason;
- quantities, when fills equal the simulator's.

This is enforced by an automated test. In live operation, any trade the simulator cannot reproduce from the same daily data (beyond fill-price differences) is a **parity violation**.

## Observation period and reviews
- **Minimum 6 months** from activation, with a **monthly review** appended to the log:
  - equity, drawdown, trades, profit factor, missed windows, parity check;
  - comparison against the development backtest distribution (rolling 6-month returns and bootstrap ranges), not against a single number.
- **Kill criteria (stop the observation):**
  - drawdown > 20% (the kill switch latches automatically);
  - any parity violation;
  - ≥ 3 consecutive missed execution windows (pause and review operations).
- **Evaluation** after ≥ 6 months **and** ≥ 15 closed trades (otherwise extend):
  - **pass** = net profit factor ≥ 1.2, max drawdown ≤ 20%, no parity violations;
  - a pass only means "candidate for a separate decision by the owner". It **never** enables live trading inside this system.
