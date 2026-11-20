const MS_PER_DAY = 86_400_000;
function validateObservations(observations) {
  if (!Array.isArray(observations) || observations.length < 3) throw new TypeError("at least three observations are required");
  let previous = -Infinity;
  for (const row of observations) {
    if (!row || !Number.isSafeInteger(row.timestamp) || row.timestamp <= previous ||
        !Number.isFinite(row.close) || row.close <= 0) {
      throw new TypeError("observations must have ascending UTC timestamps and positive finite closes");
    }
    previous = row.timestamp;
  }
}

/**
 * Trailing-window benchmark regime classifier. Classification at index i uses
 * only closes at indices <= i. This is a research label, not a predictive signal.
 */
export function classifyMarketRegimes(observations, {
  lookbackBars = 20, bullishThresholdPct = 3, bearishThresholdPct = -3,
  highVolatilityThresholdPct = 2
} = {}) {
  validateObservations(observations);
  if (!Number.isSafeInteger(lookbackBars) || lookbackBars < 2) throw new RangeError("lookbackBars must be >= 2");
  if (!Number.isFinite(bullishThresholdPct) || !Number.isFinite(bearishThresholdPct) ||
      bullishThresholdPct <= bearishThresholdPct) throw new RangeError("trend thresholds are invalid");
  if (!Number.isFinite(highVolatilityThresholdPct) || highVolatilityThresholdPct < 0) {
    throw new RangeError("highVolatilityThresholdPct must be >= 0");
  }

  const labels = [];
  for (let i = lookbackBars; i < observations.length; i++) {
    const window = observations.slice(i - lookbackBars, i + 1);
    const first = window[0].close, last = window.at(-1).close;
    const trendReturnPct = (last / first - 1) * 100;
    const returns = [];
    for (let j = 1; j < window.length; j++) returns.push(Math.log(window[j].close / window[j - 1].close));
    const mean = returns.reduce((a,b)=>a+b,0)/returns.length;
    const variance = returns.reduce((a,r)=>a+(r-mean)**2,0)/returns.length;
    const realizedVolatilityPct = Math.sqrt(variance) * Math.sqrt(MS_PER_DAY / Math.max(1, observations[i].timestamp - observations[i-1].timestamp)) * 100;
    const direction = trendReturnPct >= bullishThresholdPct ? "BULLISH" :
      trendReturnPct <= bearishThresholdPct ? "BEARISH" : "SIDEWAYS";
    labels.push(Object.freeze({
      timestamp: observations[i].timestamp, direction,
      volatility: realizedVolatilityPct >= highVolatilityThresholdPct ? "HIGH" : "NORMAL",
      trendReturnPct, realizedVolatilityPct, lookbackBars
    }));
  }
  return Object.freeze({
    status: "COMPLETE", method: "TRAILING_CLOSE_RETURN_AND_REALIZED_VOLATILITY",
    labels: Object.freeze(labels),
    limitations: "Threshold-based historical labels only; results depend on benchmark, sampling interval, lookback and thresholds. They are not predictive and do not establish causal market regimes."
  });
}

/** Summarize net trade outcomes by regime at trade entry time. */
export function summarizeTradesByEntryRegime(trades, regimeLabels) {
  if (!Array.isArray(trades) || !Array.isArray(regimeLabels)) throw new TypeError("trades and regimeLabels arrays are required");
  const labels = new Map(regimeLabels.map(row => [row.timestamp, row]));
  const groups = new Map();
  for (const trade of trades) {
    if (!trade || !Number.isSafeInteger(trade.entryTime) || !Number.isFinite(trade.netReturnPct)) {
      throw new TypeError("each trade requires integer entryTime and finite netReturnPct");
    }
    const label = labels.get(trade.entryTime);
    const key = label ? `${label.direction}_${label.volatility}` : "UNCLASSIFIED";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trade.netReturnPct);
  }
  const summary = [...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([regime, values]) => ({
    regime, tradeCount: values.length,
    meanNetReturnPct: values.reduce((a,b)=>a+b,0)/values.length,
    winRatePct: values.filter(v=>v>0).length/values.length*100,
    totalCompoundedReturnPct: (values.reduce((equity,r)=>equity*(1+r/100),1)-1)*100
  }));
  return Object.freeze({status:"COMPLETE",method:"ENTRY_TIME_REGIME_ATTRIBUTION",groups:Object.freeze(summary)});
}
