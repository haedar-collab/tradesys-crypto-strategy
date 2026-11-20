function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function quantile(sorted, p) {
  const pos=(sorted.length-1)*p, lo=Math.floor(pos), hi=Math.ceil(pos);
  return sorted[lo]+(sorted[hi]-sorted[lo])*(pos-lo);
}
function pathStats(sequence, initialCapital) {
  let equity=initialCapital, peak=initialCapital, maxDrawdownPct=0;
  for(const r of sequence){ equity*=1+r; peak=Math.max(peak,equity); maxDrawdownPct=Math.max(maxDrawdownPct,(peak-equity)/peak*100); }
  return {endingEquity:equity,netReturnPct:(equity/initialCapital-1)*100,maxDrawdownPct};
}

/**
 * Non-circular moving-block bootstrap of sequential closed-trade net returns.
 * Blocks preserve local order within each sampled block; block boundaries
 * remain random. Supply out-of-sample, fee/slippage-net returns only.
 */
export function runTradeBlockBootstrap({
  tradeReturns, blockLength=5, initialCapital=10_000,
  simulations=2_000, tradesPerSimulation=tradeReturns?.length, seed=42
}={}) {
  if(!Array.isArray(tradeReturns)||tradeReturns.length<2||tradeReturns.some(r=>!Number.isFinite(r)||r<=-1)) {
    throw new TypeError("tradeReturns must contain at least two finite decimal returns greater than -100%");
  }
  if(!Number.isSafeInteger(blockLength)||blockLength<1||blockLength>tradeReturns.length) throw new RangeError("blockLength must be within the sample length");
  if(!Number.isFinite(initialCapital)||initialCapital<=0) throw new RangeError("initialCapital must be positive");
  if(!Number.isSafeInteger(simulations)||simulations<100||simulations>100_000) throw new RangeError("simulations must be from 100 to 100000");
  if(!Number.isSafeInteger(tradesPerSimulation)||tradesPerSimulation<1||tradesPerSimulation>100_000) throw new RangeError("tradesPerSimulation is invalid");
  if(!Number.isSafeInteger(seed)||seed<0) throw new RangeError("seed must be a non-negative integer");
  const random=seededRandom(seed), endings=[], returns=[], drawdowns=[];
  for(let s=0;s<simulations;s++){
    const sequence=[];
    while(sequence.length<tradesPerSimulation){
      const start=Math.floor(random()*(tradeReturns.length-blockLength+1));
      for(let j=0;j<blockLength&&sequence.length<tradesPerSimulation;j++) sequence.push(tradeReturns[start+j]);
    }
    const stats=pathStats(sequence,initialCapital);
    endings.push(stats.endingEquity);returns.push(stats.netReturnPct);drawdowns.push(stats.maxDrawdownPct);
  }
  endings.sort((a,b)=>a-b);returns.sort((a,b)=>a-b);drawdowns.sort((a,b)=>a-b);
  return Object.freeze({
    status:"COMPLETE",method:"NON_CIRCULAR_MOVING_BLOCK_BOOTSTRAP",seed,simulations,
    blockLength,tradesPerSimulation,initialCapital,
    endingEquity:Object.freeze({p05:quantile(endings,.05),median:quantile(endings,.5),p95:quantile(endings,.95)}),
    netReturnPct:Object.freeze({p05:quantile(returns,.05),median:quantile(returns,.5),p95:quantile(returns,.95)}),
    maxDrawdownPct:Object.freeze({p50:quantile(drawdowns,.5),p95:quantile(drawdowns,.95),p99:quantile(drawdowns,.99)}),
    probabilityOfLoss:returns.filter(v=>v<0).length/simulations,
    assumptions:"Preserves local order inside sampled blocks but assumes blocks are exchangeable. Does not model regime shifts, liquidity, market impact or future distribution changes."
  });
}
