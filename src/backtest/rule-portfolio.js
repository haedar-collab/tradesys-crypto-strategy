/**
 * Shared-capital daily portfolio simulator for TF-R (round 3 protocol).
 * One account for all symbols; signals at the daily close using bars <= i;
 * entries/signal exits at the next open; initial and chandelier trailing
 * stops checked intrabar (gaps fill at the open); spot only (no leverage).
 * Research only; no orders.
 */
import { prepareRuleIndicators, entrySignal, exitSignal, RULE_STRATEGIES } from "./rule-strategies.js";
import { sma } from "../indicators/index.js";

export const TF_R = Object.freeze({
  ...RULE_STRATEGIES.TF, id: "TF", variant: "TF-R",
  trailAtr: 3, maxPositionPct: 20
});

/** Round 4 candidate (PROTOCOL-ROUND-4.md): TF-R + BTC SMA200 filter, 0.5% risk, 5% heat cap. */
export const TF_R2 = Object.freeze({
  ...TF_R, variant: "TF-R2", riskPct: 0.5, marketFilterSma: 200, maxOpenRiskPct: 5, minRiskBudgetPct: 0.1
});

/** Days (openTime) on which the market filter allows new entries: close > SMA(period), causal. */
export function marketFilterDays(bars, period = 200) {
  const closes = bars.map(b => b.close);
  const trend = sma(closes, period);
  return new Set(bars.filter((b, i) => trend[i] != null && b.close > trend[i]).map(b => b.openTime));
}

export function runRulePortfolioBacktest(seriesBySymbol, strategy = TF_R, {
  from = -Infinity, to = Infinity, initialCapital = 100_000, riskPct: riskPctOption = 1, feeBps = 10, slippageBps = 5,
  marketFilterBars = null
} = {}) {
  // A strategy that fixes its own risk per trade (TF-R2) overrides the caller default.
  const riskPct = strategy.riskPct ?? riskPctOption;
  if (strategy.marketFilterSma && !Array.isArray(marketFilterBars)) {
    throw new TypeError("this strategy requires marketFilterBars (BTCUSDT daily bars)");
  }
  const allowedDays = strategy.marketFilterSma ? marketFilterDays(marketFilterBars, strategy.marketFilterSma) : null;
  const symbols = Object.keys(seriesBySymbol).sort(); // alphabetical processing order (protocol)
  if (symbols.length === 0) throw new TypeError("at least one symbol is required");
  const fee = feeBps / 10_000, slip = slippageBps / 10_000;
  const state = Object.fromEntries(symbols.map(symbol => {
    const bars = seriesBySymbol[symbol];
    return [symbol, { bars, ind: prepareRuleIndicators(bars, strategy),
      index: new Map(bars.map((b, i) => [b.openTime, i])), pos: null, pendingEntry: null, pendingExit: null }];
  }));
  const days = [...new Set(symbols.flatMap(s => state[s].bars.map(b => b.openTime)))]
    .filter(t => t >= from && t < to).sort((a, b) => a - b);

  let cash = initialCapital;
  let lastMarked = initialCapital, peak = initialCapital, maxDrawdownPct = 0;
  const trades = [], equityCurve = [];
  const lastClose = {};

  const closePosition = (symbol, time, rawPrice, reason) => {
    const s = state[symbol], p = s.pos;
    const fill = rawPrice * (1 - slip);
    const proceeds = fill * p.qty, exitFee = proceeds * fee;
    cash += proceeds - exitFee;
    const netPnl = proceeds - exitFee - p.cost - p.entryFee;
    trades.push({ symbol, entryTime: p.entryTime, exitTime: time, entry: p.entryFill, exit: fill, quantity: p.qty,
      notional: p.cost, netPnl, equityAtEntry: p.equityAtEntry, initialRisk: p.initialRisk, returnPct: netPnl / p.cost * 100, reason, barsHeld: p.barsHeld });
    s.pos = null;
  };

  for (const day of days) {
    // 1) Next-open actions: signal exits first (free cash), then entries alphabetically.
    for (const symbol of symbols) {
      const s = state[symbol], i = s.index.get(day);
      if (i === undefined || !s.pos || !s.pendingExit) continue;
      closePosition(symbol, day, s.bars[i].open, s.pendingExit);
      s.pendingExit = null;
    }
    for (const symbol of symbols) {
      const s = state[symbol], i = s.index.get(day);
      if (i === undefined || s.pos || s.pendingEntry === null) continue;
      const signalIndex = s.pendingEntry; s.pendingEntry = null;
      const entryFill = s.bars[i].open * (1 + slip);
      const stop = entryFill - strategy.stopAtr * s.ind.atr[signalIndex];
      if (!(stop > 0 && entryFill > stop)) continue;
      const equity = lastMarked;
      const riskQty = equity * riskPct / 100 / (entryFill - stop);
      const capQty = equity * strategy.maxPositionPct / 100 / entryFill;
      const cashQty = cash / (entryFill * (1 + fee));
      let qty = Math.min(riskQty, capQty, cashQty);
      if (strategy.maxOpenRiskPct) {
        // Portfolio heat: sum of open positions' initial risk plus this trade's risk.
        const openRisk = symbols.reduce((sum, sym) => sum + (state[sym].pos?.initialRisk ?? 0), 0);
        const budget = equity * strategy.maxOpenRiskPct / 100 - openRisk;
        if (budget < equity * (strategy.minRiskBudgetPct ?? 0) / 100) continue;
        qty = Math.min(qty, budget / (entryFill - stop));
      }
      if (!(qty > 0) || qty * entryFill < 1) continue;
      const cost = qty * entryFill, entryFee = cost * fee;
      cash -= cost + entryFee;
      s.pos = { qty, entryFill, cost, entryFee, stop, initialRisk: qty * (entryFill - stop),
        highestClose: -Infinity, entryTime: day, equityAtEntry: equity, barsHeld: 0 };
    }
    // 2) Intrabar stops (including the entry bar), then close-of-day updates.
    for (const symbol of symbols) {
      const s = state[symbol], i = s.index.get(day);
      if (i === undefined) continue;
      const b = s.bars[i];
      lastClose[symbol] = b.close;
      if (s.pos && b.low <= s.pos.stop) closePosition(symbol, day, Math.min(b.open, s.pos.stop), s.pos.stop > s.pos.entryFill ? "TRAILING_STOP" : "STOP");
      if (s.pos) {
        s.pos.barsHeld++;
        s.pos.highestClose = Math.max(s.pos.highestClose, b.close);
        const atrNow = s.ind.atr[i];
        if (atrNow != null) s.pos.stop = Math.max(s.pos.stop, s.pos.highestClose - strategy.trailAtr * atrNow);
        const reason = exitSignal(strategy, s.ind, i, s.pos.barsHeld);
        if (reason) s.pendingExit = reason;
      } else if (s.pendingEntry === null && entrySignal(strategy, s.ind, i) &&
          (!allowedDays || allowedDays.has(day))) {
        s.pendingEntry = i;
      }
    }
    // 3) Mark the combined account at the close (liquidation value).
    let marked = cash;
    for (const symbol of symbols) {
      const p = state[symbol].pos;
      if (p) marked += p.qty * lastClose[symbol] * (1 - slip) * (1 - fee);
    }
    lastMarked = marked;
    peak = Math.max(peak, marked);
    maxDrawdownPct = Math.max(maxDrawdownPct, (peak - marked) / peak * 100);
    equityCurve.push({ time: day, equity: marked });
  }
  // Close anything still open at the last available close of the range.
  for (const symbol of symbols) {
    if (state[symbol].pos) closePosition(symbol, days.at(-1) ?? from, lastClose[symbol], "END_OF_RANGE");
  }
  const endingEquity = cash;
  const wins = trades.filter(t => t.netPnl > 0), losses = trades.filter(t => t.netPnl < 0);
  const grossLoss = -losses.reduce((s, t) => s + t.netPnl, 0);
  return {
    status: "COMPLETE", strategy: strategy.variant ?? strategy.id, symbols, initialCapital, endingEquity,
    netReturnPct: (endingEquity / initialCapital - 1) * 100, maxDrawdownPct,
    tradeCount: trades.length, winRatePct: trades.length ? wins.length / trades.length * 100 : 0,
    profitFactor: grossLoss > 0 ? wins.reduce((s, t) => s + t.netPnl, 0) / grossLoss : null,
    trades: trades.sort((a, b) => a.entryTime - b.entryTime || a.symbol.localeCompare(b.symbol)),
    equityCurve
  };
}
