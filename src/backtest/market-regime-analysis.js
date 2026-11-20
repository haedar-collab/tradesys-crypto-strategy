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

/** Trailing-window historical labels; each label uses data through its timestamp only. */
export function classifyMarketRegimes(observations, {
  lookbackBars = 20, bullishThresholdPct = 3, bearishThresholdPct = -3,
  highVolatilityThresholdPct = 2
} = {}) {
  validateObservations(observations);
  if (!Number.isSafeInteger(lookbackBars) || lookbackBars < 2) throw new RangeError("lookbackBars must be >= 2");
  if (!Number.isFinite(bullishThresholdPct) || !Number.isFinite(bearishThresholdPct) || bullishThresholdPct <= bearishThresholdPct) throw new RangeError("trend thresholds are invalid");
  if (!Number.isFinite(highVolatilityThresholdPct) || highVolatilityThresholdPct < 0) throw new RangeError("highVolatilityThresholdPct must be >= 0");
  const labels = [];
  for (let i = lookbackBars; i < observations.length; i++) {
    const window = observations.slice(i - lookbackBars, i + 1);
    const trendReturnPct = (window.at(-1).close / window[0].close - 1) * 100;
    const returns = [];
    for (let j = 1; j < window.length; j++) returns.push(Math.log(window[j].close / window[j - 1].close));
    const mean = returns.reduce((a,b)=>a+b,0)/returns.length;
    const variance = returns.reduce((a,r)=>a+(r-mean)**2,0)/returns.length;
    const intervalMs = observations[i].timestamp - observations[i-1].timestamp;
    const realizedVolatilityPct = Math.sqrt(variance) * Math.sqrt(MS_PER_DAY / intervalMs) * 100;
    labels.push(Object.freeze({
      timestamp:observations[i].timestamp,
      direction:trendReturnPct >= bullishThresholdPct ? "BULLISH" : trendReturnPct <= bearishThresholdPct ? "BEARISH" : "SIDEWAYS",
      volatility:realizedVolatilityPct >= highVolatilityThresholdPct ? "HIGH" : "NORMAL",
      trendReturnPct, realizedVolatilityPct, lookbackBars
    }));
  }
  return Object.freeze({status:"COMPLETE",method:"TRAILING_CLOSE_RETURN_AND_REALIZED_VOLATILITY",
    labels:Object.freeze(labels),
    limitations:"Threshold-based descriptive labels only; not predictive. Sampling interval, benchmark, lookback and thresholds must be calibrated."});
}

/**
 * Attribute each trade to the most recent regime label at or before entryTime.
 * This avoids dropping trades merely because bar close and trade entry timestamps differ.
 */
export function summarizeTradesByEntryRegime(trades, regimeLabels) {
  if (!Array.isArray(trades) || !Array.isArray(regimeLabels)) throw new TypeError("trades and regimeLabels arrays are required");
  let previous = -Infinity;
  for (const label of regimeLabels) {
    if (!label || !Number.isSafeInteger(label.timestamp) || label.timestamp <= previous ||
        !["BULLISH","BEARISH","SIDEWAYS"].includes(label.direction) ||
        !["HIGH","NORMAL"].includes(label.volatility)) throw new TypeError("regime labels must be valid and sorted by timestamp");
    previous = label.timestamp;
  }
  const groups = new Map();
  for (const trade of trades) {
    if (!trade || !Number.isSafeInteger(trade.entryTime) || !Number.isFinite(trade.netReturnPct)) throw new TypeError("each trade requires integer entryTime and finite netReturnPct");
    let lo=0, hi=regimeLabels.length-1, match=-1;
    while(lo<=hi){const mid=(lo+hi)>>1;if(regimeLabels[mid].timestamp<=trade.entryTime){match=mid;lo=mid+1;}else hi=mid-1;}
    const label=match>=0?regimeLabels[match]:null;
    const key=label?`${label.direction}_${label.volatility}`:"UNCLASSIFIED";
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(trade.netReturnPct);
  }
  const summary=[...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([regime,values])=>({
    regime,tradeCount:values.length,meanNetReturnPct:values.reduce((a,b)=>a+b,0)/values.length,
    winRatePct:values.filter(v=>v>0).length/values.length*100,
    totalCompoundedReturnPct:(values.reduce((equity,r)=>equity*(1+r/100),1)-1)*100
  }));
  return Object.freeze({status:"COMPLETE",method:"LATEST_AVAILABLE_REGIME_AT_ENTRY",groups:Object.freeze(summary)});
}
