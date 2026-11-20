/**
 * Parameter sensitivity matrix. This measures outcome variation across
 * researcher-defined settings; it does not optimize or select a live config.
 */
function validateMetric(result, key) {
  const value=result?.[key];
  if(!Number.isFinite(value)) throw new TypeError(`backtest result must contain finite ${key}`);
  return value;
}
function percentile(values,p) {
  const sorted=[...values].sort((a,b)=>a-b);
  const position=(sorted.length-1)*p,lo=Math.floor(position),hi=Math.ceil(position);
  return sorted[lo]+(sorted[hi]-sorted[lo])*(position-lo);
}
export function runParameterSensitivity(runner,input,parameterSets,options={}) {
  if(typeof runner!=="function") throw new TypeError("runner must be a function");
  if(!input||typeof input!=="object"||Array.isArray(input)) throw new TypeError("baseline input is required");
  if(!Array.isArray(parameterSets)||parameterSets.length<2||
    parameterSets.some(p=>!p||typeof p!=="object"||Array.isArray(p))) {
    throw new TypeError("at least two parameter sets are required");
  }
  const metric=options.metric??"netReturnPct";
  const results=parameterSets.map((parameters,index)=>{
    const result=runner({...input,...parameters});
    const metricValue=validateMetric(result,metric);
    const netReturnPct=validateMetric(result,"netReturnPct");
    const maxDrawdownPct=validateMetric(result,"maxDrawdownPct");
    return {index,parameters:{...parameters},metricValue,netReturnPct,maxDrawdownPct,
      profitFactor:Number.isFinite(result.profitFactor)?result.profitFactor:null,
      tradeCount:Number.isFinite(result.tradeCount)?result.tradeCount:null,
      endingEquity:Number.isFinite(result.endingEquity)?result.endingEquity:null};
  });
  const metricValues=results.map(r=>r.metricValue);
  const returns=results.map(r=>r.netReturnPct);
  const drawdowns=results.map(r=>r.maxDrawdownPct);
  const mean=values=>values.reduce((s,v)=>s+v,0)/values.length;
  const best=[...results].sort((a,b)=>b.metricValue-a.metricValue||a.index-b.index)[0];
  const worst=[...results].sort((a,b)=>a.metricValue-b.metricValue||a.index-b.index)[0];
  return {
    status:"COMPLETE",metric,scenarioCount:results.length,results,
    summary:{
      metricMin:Math.min(...metricValues),metricMedian:percentile(metricValues,.5),
      metricMax:Math.max(...metricValues),metricRange:Math.max(...metricValues)-Math.min(...metricValues),
      meanNetReturnPct:mean(returns),netReturnRangePct:Math.max(...returns)-Math.min(...returns),
      meanMaxDrawdownPct:mean(drawdowns),maxObservedDrawdownPct:Math.max(...drawdowns),
      positiveReturnScenarioCount:returns.filter(x=>x>0).length,
      negativeReturnScenarioCount:returns.filter(x=>x<0).length,
      bestScenarioIndex:best.index,worstScenarioIndex:worst.index
    },
    assumptions:{
      fixedInputs:"market data, signals, and non-overridden settings remain constant across scenarios",
      interpretation:"wide metric ranges or sign changes indicate parameter fragility; a narrow range does not prove profitability",
      noOptimization:"results are descriptive only; this function does not choose or deploy parameters",
      scope:"only parameters actually consumed by the supplied runner have an effect"
    }
  };
}
