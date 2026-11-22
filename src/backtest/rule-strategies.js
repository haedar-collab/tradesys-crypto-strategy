/**
 * Daily, long-only spot rule strategies for research (round 2 protocol).
 * Signals are evaluated at the daily close using bars <= i only; entries and
 * signal exits fill at the next daily open; stops are checked intrabar and a
 * gap through the stop fills at the open. Research only; no orders.
 */
import { sma, rsi, atr } from "../indicators/index.js";

export const RULE_STRATEGIES = Object.freeze({
  TF: Object.freeze({
    id: "TF", name: "Donchian 55/20 breakout with SMA200 filter",
    entryLookback: 55, exitLookback: 20, trendSma: 200, stopAtr: 2
  }),
  MR: Object.freeze({
    id: "MR", name: "RSI(2) < 10 pullback above SMA200",
    trendSma: 200, rsiPeriod: 2, rsiEntry: 10, exitSma: 5, maxHoldBars: 10, stopAtr: 3
  })
});

function rollingExtreme(values, lookback, i, pick) {
  if (i < lookback) return null;
  let out = values[i - lookback];
  for (let k = i - lookback + 1; k < i; k++) out = pick(out, values[k]);
  return out; // previous `lookback` bars, excluding bar i
}

/** Precompute causal indicators over a full daily series. */
export function prepareRuleIndicators(bars, strategy) {
  const close = bars.map(b => b.close), high = bars.map(b => b.high), low = bars.map(b => b.low);
  return {
    close, high, low,
    trend: sma(close, strategy.trendSma),
    atr: atr(high, low, close, 14),
    rsi: strategy.id === "MR" ? rsi(close, strategy.rsiPeriod) : null,
    exitSma: strategy.id === "MR" ? sma(close, strategy.exitSma) : null
  };
}

export function entrySignal(strategy, ind, i) {
  const { close, trend, atr: a } = ind;
  if (trend[i] == null || a[i] == null || !(close[i] > trend[i])) return false;
  if (strategy.id === "TF") {
    const hh = rollingExtreme(ind.high, strategy.entryLookback, i, Math.max);
    return hh !== null && close[i] > hh;
  }
  return ind.rsi[i] != null && ind.rsi[i] < strategy.rsiEntry;
}

export function exitSignal(strategy, ind, i, barsHeld) {
  if (strategy.id === "TF") {
    const ll = rollingExtreme(ind.low, strategy.exitLookback, i, Math.min);
    return ll !== null && ind.close[i] < ll ? "DONCHIAN_EXIT" : null;
  }
  if (ind.exitSma[i] != null && ind.close[i] > ind.exitSma[i]) return "CLOSE_ABOVE_SMA5";
  if (barsHeld >= strategy.maxHoldBars) return "TIME_STOP";
  return null;
}

/**
 * Simulate one strategy on daily bars, trading only bars with openTime in
 * [from, to). Indicators come from the full series (warm-up before `from`).
 */
export function runRuleStrategyBacktest(bars, strategy, {
  from = -Infinity, to = Infinity, initialCapital = 10_000, riskPct = 1, feeBps = 10, slippageBps = 5
} = {}) {
  if (!Array.isArray(bars) || bars.length < 2) throw new TypeError("at least two daily bars are required");
  if (!RULE_STRATEGIES[strategy?.id]) throw new TypeError("unknown rule strategy");
  const ind = prepareRuleIndicators(bars, strategy);
  const fee = feeBps / 10_000, slip = slippageBps / 10_000;
  let equity = initialCapital, peak = initialCapital, maxDrawdownPct = 0;
  let pos = null, pendingEntry = null, pendingExit = null;
  const trades = [];
  const inRange = i => bars[i].openTime >= from && bars[i].openTime < to;

  const close = (i, rawPrice, reason) => {
    const fill = rawPrice * (1 - slip);
    const gross = (fill - pos.entryFill) * pos.qty;
    const exitFee = fill * pos.qty * fee;
    const netPnl = gross - pos.entryFee - exitFee;
    equity += netPnl;
    trades.push({ entryTime: pos.entryTime, exitTime: bars[i].openTime, entry: pos.entryFill, exit: fill,
      quantity: pos.qty, notional: pos.notional, netPnl, fees: pos.entryFee + exitFee,
      returnPct: netPnl / pos.notional * 100, reason, barsHeld: pos.barsHeld });
    pos = null;
  };

  for (let i = 0; i < bars.length; i++) {
    if (!inRange(i)) {
      // Leaving the range closes any open position at that bar's open.
      if (pos && bars[i].openTime >= to) close(i, bars[i].open, "END_OF_RANGE");
      pendingEntry = null; pendingExit = null;
      continue;
    }
    const b = bars[i];
    if (pos && pendingExit) { close(i, b.open, pendingExit); pendingExit = null; }
    if (!pos && pendingEntry !== null) {
      const s = pendingEntry; pendingEntry = null;
      const entryFill = b.open * (1 + slip);
      const stop = entryFill - strategy.stopAtr * ind.atr[s];
      if (stop > 0 && entryFill > stop) {
        const riskQty = equity * riskPct / 100 / (entryFill - stop);
        const qty = Math.min(riskQty, equity / (entryFill * (1 + fee)));
        if (qty > 0) {
          const notional = qty * entryFill;
          pos = { entryFill, stop, qty, notional, entryFee: notional * fee, entryTime: b.openTime, barsHeld: 0 };
        }
      }
    }
    if (pos) {
      // Intrabar stop, including the entry bar; a gap below fills at the open.
      if (b.low <= pos.stop) close(i, Math.min(b.open, pos.stop), "STOP");
      else {
        pos.barsHeld++;
        const reason = exitSignal(strategy, ind, i, pos.barsHeld);
        if (reason) pendingExit = reason;
      }
    }
    if (!pos && pendingEntry === null && entrySignal(strategy, ind, i)) pendingEntry = i;
    const marked = equity + (pos ? (b.close * (1 - slip) * (1 - fee) - pos.entryFill) * pos.qty - pos.entryFee : 0);
    peak = Math.max(peak, marked);
    maxDrawdownPct = Math.max(maxDrawdownPct, (peak - marked) / peak * 100);
  }
  const last = bars.length - 1;
  if (pos) close(last, bars[last].close, "END_OF_DATA");
  const wins = trades.filter(t => t.netPnl > 0), losses = trades.filter(t => t.netPnl < 0);
  const grossLoss = -losses.reduce((s, t) => s + t.netPnl, 0);
  return {
    status: "COMPLETE", strategy: strategy.id, initialCapital, endingEquity: equity,
    netReturnPct: (equity / initialCapital - 1) * 100, maxDrawdownPct,
    tradeCount: trades.length, winRatePct: trades.length ? wins.length / trades.length * 100 : 0,
    profitFactor: grossLoss > 0 ? wins.reduce((s, t) => s + t.netPnl, 0) / grossLoss : null,
    trades
  };
}
