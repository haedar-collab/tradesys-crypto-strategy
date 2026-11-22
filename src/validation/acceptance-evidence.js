/**
 * Build the strategy acceptance evidence bundle from historical candles.
 *
 * Pure functions only (no network, no files). The pipeline is:
 *   windowed causal replay -> executable signals -> event backtests
 *   (full period, cost stress, chronological folds) -> regime attribution
 *   -> moving-block bootstrap -> report in the evaluateStrategyAcceptance()
 *   input contract.
 *
 * Every decision uses only candles that closed strictly before its evaluation
 * time, with the same lookback windows as the live screener.
 */
import { evaluateCausalMultiTimeframeSetup } from "../engine/causal-mtf.js";
import { runEventBacktest } from "../backtest/event-driven.js";
import { runTradeBlockBootstrap } from "../backtest/block-bootstrap.js";
import { classifyMarketRegimes, summarizeTradesByEntryRegime } from "../backtest/market-regime-analysis.js";
import { validateOhlcDataset } from "../data/ohlc-dataset-quality.js";
import { BINANCE_SPOT_SCREENER_LOOKBACK_BARS, BINANCE_SPOT_SCREENER_MINIMUM_BARS } from "../screener/binance-spot-mtf-screener.js";

const HOUR = 3_600_000;
// Reasons decided solely by closed weekly/daily candles (identical for every
// evaluation until the next daily close), see evaluateMultiTimeframeSetup().
const DAILY_LEVEL_GATES = new Set([
  "WEEKLY_CONTEXT_PROVISIONAL", "INVALID_WEEKLY_BIAS", "WEEKLY_BIAS_BEARISH",
  "DAILY_BIAS_NOT_BULLISH", "MARKET_REGIME_UNCONFIRMED", "INVALID_MARKET_REGIME", "MARKET_REGIME_DOWNTREND"
]);

/** Candles with closeTime < t, newest `count` of them (input sorted by openTime). */
export function closedWindow(candles, t, count) {
  let lo = 0, hi = candles.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (candles[mid].closeTime < t) lo = mid + 1; else hi = mid; }
  return candles.slice(Math.max(0, lo - count), lo);
}
function closedCount(candles, t) {
  let lo = 0, hi = candles.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (candles[mid].closeTime < t) lo = mid + 1; else hi = mid; }
  return lo;
}

/**
 * Causal replay at every H1 close in [start, end). Exact shortcut: once a
 * daily-level gate blocks, every later evaluation with the same closed daily
 * candle set has the same outcome, so it is recorded without re-evaluating.
 */
export function replayCandidates(timeframes, { start, end, stepHours = 1, lookbacks = BINANCE_SPOT_SCREENER_LOOKBACK_BARS,
  minimumBars = BINANCE_SPOT_SCREENER_MINIMUM_BARS, skipDailyGates = true, strategyOptions = {} } = {}) {
  const decisions = [];
  const stats = { evaluations: 0, computed: 0, skippedByDailyGate: 0, candidates: 0, reasons: {} };
  let blockedDailyCount = -1, blockedReason = null;
  for (const candle of timeframes.h1) {
    const t = candle.closeTime + 1;
    if (t < start || t >= end) continue;
    if (Math.floor((t - start) / HOUR) % stepHours !== 0) continue;
    stats.evaluations++;
    const dailyCount = closedCount(timeframes.daily, t);
    let reason;
    if (skipDailyGates && dailyCount === blockedDailyCount) {
      stats.skippedByDailyGate++;
      reason = blockedReason;
    } else {
      stats.computed++;
      const decision = evaluateCausalMultiTimeframeSetup({
        weekly: closedWindow(timeframes.weekly, t, lookbacks.weekly),
        daily: closedWindow(timeframes.daily, t, lookbacks.daily),
        h4: closedWindow(timeframes.h4, t, lookbacks.h4),
        h1: closedWindow(timeframes.h1, t, lookbacks.h1)
      }, { ...strategyOptions, evaluationTime: t, minimumBars, requireContiguous: false });
      reason = decision.reasons?.[0] ?? (decision.candidate ? "BUY_CANDIDATE" : "NO_REASON");
      if (DAILY_LEVEL_GATES.has(reason)) { blockedDailyCount = dailyCount; blockedReason = reason; }
      else blockedDailyCount = -1;
      if (decision.candidate === true) {
        stats.candidates++;
        decisions.push({ evaluationTime: t, candidate: true,
          plan: decision.plan, regime: decision.regime?.effective ?? null, trigger: decision.trigger ?? null });
      }
    }
    stats.reasons[reason] = (stats.reasons[reason] ?? 0) + 1;
  }
  return { decisions, stats };
}

/** Map candidates to the H1 bar that closed at evaluationTime - 1 (entry: next bar open). */
export function candidatesToSignals(h1, decisions) {
  const index = new Map(h1.map((c, i) => [c.closeTime + 1, i]));
  const signals = [];
  for (const d of decisions) {
    const i = index.get(d.evaluationTime);
    if (!Number.isInteger(i) || i >= h1.length - 1) continue;
    const p = d.plan;
    if (!p || ![p.entry, p.stop, p.tp1, p.tp2, p.tp3].every(Number.isFinite)) continue;
    if (!(p.stop < p.entry && p.entry < p.tp1 && p.tp1 < p.tp2 && p.tp2 < p.tp3)) continue;
    signals.push({ index: i, plan: { entry: p.entry, stop: p.stop, tp1: p.tp1, tp2: p.tp2, tp3: p.tp3 } });
  }
  return signals;
}

/** Event backtest over H1 bars with openTime in [from, to). */
export function backtestRange(h1, decisions, { from, to, initialCapital = 10_000, riskPct = 1, feeBps = 10, slippageBps = 5, exitModel, minRR } = {}) {
  const bars = h1.filter(c => c.openTime >= from && c.openTime < to);
  if (bars.length < 2) return null;
  const inRange = decisions.filter(d => d.evaluationTime > bars[0].openTime && d.evaluationTime <= bars.at(-1).closeTime + 1);
  const signals = candidatesToSignals(bars, inRange);
  const result = runEventBacktest({
    bars: bars.map(c => ({ t: c.openTime, o: c.open, h: c.high, l: c.low, c: c.close })),
    signals, initialCapital, riskPct, feeBps, slippageBps,
    ...(exitModel ? { exitModel } : {}), ...(minRR ? { minRR } : {})
  });
  return { ...result, signalCount: signals.length };
}

/** Closed-trade returns relative to account equity before each trade. */
export function accountTradeReturns(backtest, initialCapital = 10_000) {
  let equity = initialCapital;
  return backtest.trades.map(trade => {
    // Portfolio trades carry the marked equity at entry; otherwise compound.
    const r = trade.netPnl / (Number.isFinite(trade.equityAtEntry) ? trade.equityAtEntry : equity);
    equity += trade.netPnl;
    return { entryTime: trade.entryTime, exitTime: trade.exitTime, netPnl: trade.netPnl, accountReturn: r, netReturnPct: r * 100 };
  });
}

/** Contiguous, equal-length chronological folds over [start, end). */
export function chronologicalFolds(start, end, count) {
  if (!Number.isSafeInteger(count) || count < 1) throw new RangeError("fold count must be a positive integer");
  const span = Math.floor((end - start) / count / HOUR) * HOUR;
  return Array.from({ length: count }, (_, i) => ({
    index: i, from: start + i * span, to: i === count - 1 ? end : start + (i + 1) * span
  }));
}

/**
 * Data-quality policy for the evaluation window: no malformed, duplicate or
 * out-of-order bars; missing H1 intervals (exchange outages) at most 0.1% of
 * bars and no single gap longer than 24 hours. Gaps are reported, not filled.
 */
export function assessDataQuality(datasets, { maxMissingRatio = 0.001, maxGapHours = 24 } = {}) {
  const checks = datasets.map(({ symbol, interval, candles, from, to }) => {
    const bars = candles.filter(c => c.openTime >= from && c.openTime < to)
      .map(c => ({ t: c.openTime, o: c.open, h: c.high, l: c.low, c: c.close }));
    const report = validateOhlcDataset({ symbol, interval, bars });
    const missing = report.issues.filter(i => i.type === "MISSING_INTERVALS");
    const missingBars = missing.reduce((s, i) => s + i.missing, 0);
    const stepHours = { "1h": 1, "4h": 4, "1d": 24, "1w": 168 }[interval];
    const longestGapHours = missing.reduce((m, i) => Math.max(m, i.missing * stepHours), 0);
    const structural = report.metrics.malformed + report.metrics.duplicates + (report.metrics.ordered ? 0 : 1);
    const ok = structural === 0 && missingBars / Math.max(1, bars.length) <= maxMissingRatio && longestGapHours <= maxGapHours;
    return { symbol, interval, barCount: bars.length, malformed: report.metrics.malformed, duplicates: report.metrics.duplicates,
      ordered: report.metrics.ordered, missingBars, longestGapHours, status: ok ? "PASS" : "FAIL" };
  });
  return { status: checks.every(c => c.status === "PASS") ? "PASS" : "FAIL",
    policy: { maxMissingRatio, maxGapHours, structuralIssuesAllowed: 0 }, checks };
}

const profitFactor = trades => {
  const wins = trades.filter(t => t.netPnl > 0).reduce((s, t) => s + t.netPnl, 0);
  const losses = -trades.filter(t => t.netPnl < 0).reduce((s, t) => s + t.netPnl, 0);
  return losses > 0 ? wins / losses : (wins > 0 ? Infinity : null);
};

/**
 * Equal-weight portfolio of independent per-symbol sub-accounts.
 * netReturnPct: mean of per-symbol marked returns; maxDrawdownPct: the worst
 * per-symbol marked drawdown (an upper bound for the equal-weight portfolio);
 * profitFactor over all closed trades in currency (equal initial capital).
 */
export function aggregateBacktests(perSymbol) {
  const valid = perSymbol.filter(x => x.backtest);
  const trades = valid.flatMap(x => x.backtest.trades);
  const pf = profitFactor(trades);
  return {
    symbolCount: valid.length,
    tradeCount: trades.length,
    profitFactor: pf === Infinity ? 999 : pf,
    netReturnPct: valid.length ? valid.reduce((s, x) => s + x.backtest.netReturnPct, 0) / valid.length : 0,
    maxDrawdownPct: valid.reduce((m, x) => Math.max(m, x.backtest.maxDrawdownPct), 0),
    winRatePct: trades.length ? trades.filter(t => t.netPnl > 0).length / trades.length * 100 : null
  };
}

/** Assemble the evaluateStrategyAcceptance() input from per-symbol replays. */
export function buildAcceptanceEvidence({ symbols, start, end, folds = 6, benchmarkDaily,
  baseCosts = { feeBps: 10, slippageBps: 5 }, stressCosts = { feeBps: 20, slippageBps: 20 },
  riskPct = 1, initialCapital = 10_000, dataQuality, bootstrap = { blockLength: 5, simulations: 2_000, seed: 42 },
  execution = {},
  // Strategy-agnostic hook: (symbolData, { from, to, initialCapital, riskPct, feeBps, slippageBps, ... }) => backtest.
  runBacktest = (s, options) => backtestRange(s.h1, s.decisions, options) }) {
  const run = costs => symbols.map(s => ({ symbol: s.symbol,
    backtest: runBacktest(s, { from: start, to: end, initialCapital, riskPct, ...execution, ...costs }) }));
  const base = run(baseCosts);
  const stress = run(stressCosts);
  const oos = aggregateBacktests(base);
  const stressAgg = aggregateBacktests(stress);

  const foldResults = chronologicalFolds(start, end, folds).map(fold => {
    const agg = aggregateBacktests(symbols.map(s => ({ symbol: s.symbol,
      backtest: runBacktest(s, { from: fold.from, to: fold.to, initialCapital, riskPct, ...execution, ...baseCosts }) })));
    return { ...fold, fromIso: new Date(fold.from).toISOString(), toIso: new Date(fold.to).toISOString(),
      tradeCount: agg.tradeCount, netReturnPct: agg.netReturnPct, profitFactor: agg.profitFactor, maxDrawdownPct: agg.maxDrawdownPct };
  });

  const accountTrades = base.filter(x => x.backtest)
    .flatMap(x => accountTradeReturns(x.backtest, initialCapital).map(t => ({ ...t, symbol: x.symbol })))
    .sort((a, b) => a.entryTime - b.entryTime);

  // Benchmark (BTC) daily regime labels, timestamped at the daily close so a
  // label is only used after the candle that produced it has closed.
  const labels = classifyMarketRegimes(benchmarkDaily.map(c => ({ timestamp: c.closeTime, close: c.close }))).labels;
  const regimeGroups = accountTrades.length
    ? summarizeTradesByEntryRegime(accountTrades.map(t => ({ entryTime: t.entryTime, netReturnPct: t.netReturnPct })), labels)
    : null;

  const bootstrapResult = accountTrades.length >= Math.max(2, bootstrap.blockLength)
    ? runTradeBlockBootstrap({ tradeReturns: accountTrades.map(t => t.accountReturn), initialCapital, ...bootstrap })
    : null;

  return {
    dataQuality: { status: dataQuality.status, policy: dataQuality.policy, checks: dataQuality.checks },
    outOfSample: oos.tradeCount > 0 ? {
      tradeCount: oos.tradeCount, profitFactor: oos.profitFactor, netReturnPct: oos.netReturnPct,
      maxDrawdownPct: oos.maxDrawdownPct, winRatePct: oos.winRatePct
    } : { tradeCount: 0, profitFactor: null, netReturnPct: null, maxDrawdownPct: null },
    walkForward: { method: "CHRONOLOGICAL_SEGMENTS_FIXED_PARAMETERS", folds: foldResults },
    regimeAnalysis: { benchmark: "BTCUSDT daily close, 20-bar trend and realized volatility",
      groups: regimeGroups?.groups ?? regimeGroups?.summary ?? [] },
    costStress: { feeBps: stressCosts.feeBps, slippageBps: stressCosts.slippageBps,
      profitFactor: stressAgg.tradeCount ? stressAgg.profitFactor : null,
      netReturnPct: stressAgg.tradeCount ? stressAgg.netReturnPct : null, tradeCount: stressAgg.tradeCount },
    blockBootstrap: bootstrapResult ? { blockLength: bootstrapResult.blockLength, simulations: bootstrapResult.simulations,
      seed: bootstrapResult.seed, maxDrawdownPct: bootstrapResult.maxDrawdownPct, netReturnPct: bootstrapResult.netReturnPct,
      probabilityOfLoss: bootstrapResult.probabilityOfLoss } : null,
    perSymbol: base.map((x, i) => ({ symbol: x.symbol,
      tradeCount: x.backtest?.tradeCount ?? 0, netReturnPct: x.backtest?.netReturnPct ?? null,
      maxDrawdownPct: x.backtest?.maxDrawdownPct ?? null, profitFactor: x.backtest?.profitFactor ?? null,
      winRatePct: x.backtest?.winRatePct ?? null, signalCount: x.backtest?.signalCount ?? 0,
      stressNetReturnPct: stress[i].backtest?.netReturnPct ?? null })),
    tradeLog: accountTrades.map(t => ({ symbol: t.symbol, entryTime: t.entryTime, exitTime: t.exitTime,
      netPnl: Number(t.netPnl.toFixed(4)), accountReturnPct: Number(t.netReturnPct.toFixed(4)) }))
  };
}
