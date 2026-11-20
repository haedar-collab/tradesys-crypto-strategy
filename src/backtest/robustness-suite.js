function assertFiniteArray(values, name) {
  if (!Array.isArray(values) || values.length === 0 || values.some(v => !Number.isFinite(v))) {
    throw new TypeError(`${name} must be a non-empty array of finite numbers`);
  }
}
function setPathImmutable(source, path, value) {
  const parts = path.split(".");
  if (!parts.length || parts.some(p => !p)) throw new TypeError("parameter path is invalid");
  const clone = structuredClone(source);
  let target = clone;
  for (const part of parts.slice(0,-1)) {
    if (!target || typeof target !== "object" || !(part in target)) throw new RangeError(`unknown parameter path: ${path}`);
    target = target[part];
  }
  if (!target || typeof target !== "object" || !(parts.at(-1) in target)) throw new RangeError(`unknown parameter path: ${path}`);
  target[parts.at(-1)] = value;
  return clone;
}
function validateBacktestResult(result) {
  if (!result || !Number.isFinite(result.netReturnPct) ||
      !Number.isFinite(result.endingEquity) || !Number.isFinite(result.maxDrawdownPct)) {
    throw new TypeError("backtest runner must return finite netReturnPct, endingEquity and maxDrawdownPct");
  }
  return result;
}

/**
 * One-factor-at-a-time parameter sensitivity. Each run receives an isolated
 * deep clone; the original input and parameter object are never mutated.
 */
export function runParameterSensitivity(runBacktest, input, parameterGrid) {
  if (typeof runBacktest !== "function") throw new TypeError("runBacktest must be a function");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("input is required");
  if (!parameterGrid || typeof parameterGrid !== "object" || Array.isArray(parameterGrid) || !Object.keys(parameterGrid).length) {
    throw new TypeError("parameterGrid must be a non-empty object");
  }
  const results = [];
  for (const [path, values] of Object.entries(parameterGrid)) {
    if (!Array.isArray(values) || !values.length) throw new TypeError(`parameter values required for ${path}`);
    for (const value of values) {
      if (typeof value !== "number" && typeof value !== "boolean" && typeof value !== "string") {
        throw new TypeError(`unsupported parameter value for ${path}`);
      }
      const scenarioInput = setPathImmutable(input, path, value);
      const result = validateBacktestResult(runBacktest(scenarioInput));
      results.push({ parameter:path, value, netReturnPct:result.netReturnPct,
        endingEquity:result.endingEquity, maxDrawdownPct:result.maxDrawdownPct,
        profitFactor:Number.isFinite(result.profitFactor)?result.profitFactor:null,
        tradeCount:Number.isInteger(result.tradeCount)?result.tradeCount:null });
    }
  }
  return { status:"COMPLETE", method:"ONE_FACTOR_AT_A_TIME", scenarioCount:results.length,
    results, limitations:"Sensitivity is conditional on the supplied fixed data and runner; it is not a parameter optimizer or proof of out-of-sample performance." };
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function summarizePath(returns, initialCapital) {
  let equity=initialCapital, peak=initialCapital, maxDrawdownPct=0;
  for(const r of returns){
    equity *= 1 + r;
    peak=Math.max(peak,equity);
    maxDrawdownPct=Math.max(maxDrawdownPct,(peak-equity)/peak*100);
  }
  return {endingEquity:equity,netReturnPct:(equity/initialCapital-1)*100,maxDrawdownPct};
}
function percentile(sorted, p) {
  const position=(sorted.length-1)*p, lower=Math.floor(position), upper=Math.ceil(position);
  return sorted[lower]+(sorted[upper]-sorted[lower])*(position-lower);
}

/**
 * Bootstrap Monte Carlo over CLOSED trade net returns. This estimates sequence
 * risk conditional on the observed trade-return sample; it does not create
 * new market data or model regime changes.
 */
export function runTradeSequenceMonteCarlo({
  tradeReturns, initialCapital=10_000, simulations=1_000,
  tradesPerSimulation=tradeReturns?.length, seed=42
}={}) {
  assertFiniteArray(tradeReturns,"tradeReturns");
  if (tradeReturns.some(r=>r<=-1)) throw new RangeError("trade returns must be greater than -100%");
  if (!Number.isFinite(initialCapital)||initialCapital<=0) throw new RangeError("initialCapital must be positive");
  if (!Number.isSafeInteger(simulations)||simulations<100||simulations>100_000) throw new RangeError("simulations must be an integer from 100 to 100000");
  if (!Number.isSafeInteger(tradesPerSimulation)||tradesPerSimulation<1||tradesPerSimulation>100_000) throw new RangeError("tradesPerSimulation is invalid");
  if (!Number.isSafeInteger(seed)||seed<0) throw new RangeError("seed must be a non-negative integer");
  const random=mulberry32(seed), endings=[], returns=[], drawdowns=[];
  for(let s=0;s<simulations;s++){
    const sequence=Array.from({length:tradesPerSimulation},()=>tradeReturns[Math.floor(random()*tradeReturns.length)]);
    const stats=summarizePath(sequence,initialCapital);
    endings.push(stats.endingEquity);returns.push(stats.netReturnPct);drawdowns.push(stats.maxDrawdownPct);
  }
  endings.sort((a,b)=>a-b);returns.sort((a,b)=>a-b);drawdowns.sort((a,b)=>a-b);
  return {status:"COMPLETE",method:"BOOTSTRAP_WITH_REPLACEMENT",seed,simulations,tradesPerSimulation,
    initialCapital,endingEquity:{p05:percentile(endings,.05),median:percentile(endings,.5),p95:percentile(endings,.95)},
    netReturnPct:{p05:percentile(returns,.05),median:percentile(returns,.5),p95:percentile(returns,.95)},
    maxDrawdownPct:{p50:percentile(drawdowns,.5),p95:percentile(drawdowns,.95),p99:percentile(drawdowns,.99)},
    probabilityOfLoss:returns.filter(v=>v<0).length/simulations,
    assumptions:"Closed trade net returns are independently resampled with replacement. Serial dependence, changing regimes, liquidity, and parameter uncertainty are not modeled."};
}
