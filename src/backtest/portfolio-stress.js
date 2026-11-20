import { runPortfolioBacktest } from "./portfolio.js";
import { pearsonCorrelation } from "../risk/portfolio.js";

function validateScenario(scenario, symbols, barCount) {
  if (!scenario || typeof scenario.name !== "string" || !scenario.name.trim() ||
      !Number.isInteger(scenario.shockIndex) || scenario.shockIndex < 1 || scenario.shockIndex >= barCount ||
      !scenario.shocks || typeof scenario.shocks !== "object" || Array.isArray(scenario.shocks)) throw new TypeError("invalid portfolio stress scenario");
  for (const [symbol, shockPct] of Object.entries(scenario.shocks)) {
    if (!symbols.includes(symbol)) throw new RangeError(`unknown stress symbol: ${symbol}`);
    if (!Number.isFinite(shockPct) || shockPct <= -100 || shockPct > 500) throw new RangeError(`invalid shock percentage for ${symbol}`);
  }
  if (scenario.recoveryEndIndex != null && (!Number.isInteger(scenario.recoveryEndIndex) || scenario.recoveryEndIndex <= scenario.shockIndex || scenario.recoveryEndIndex >= barCount)) throw new RangeError("invalid recoveryEndIndex");
  const blend = scenario.correlationBlend ?? 0;
  if (!Number.isFinite(blend) || blend < 0 || blend > 1) throw new RangeError("correlationBlend must be between 0 and 1");
}
function correlationSummary(assets) {
  const symbols=Object.keys(assets).sort(), values=[];
  for(let i=0;i<symbols.length;i++) for(let j=i+1;j<symbols.length;j++)
    values.push(pearsonCorrelation(assets[symbols[i]].dailyReturns,assets[symbols[j]].dailyReturns));
  const valid=values.filter(Number.isFinite);
  return {pairCount:values.length,validPairCount:valid.length,
    averagePairwiseCorrelation:valid.length?valid.reduce((s,x)=>s+x,0)/valid.length:null,
    maximumPairwiseCorrelation:valid.length?Math.max(...valid):null};
}
function stressReturns(assets,blend) {
  const symbols=Object.keys(assets), arrays=symbols.map(s=>assets[s].dailyReturns);
  if(blend===0) return Object.fromEntries(symbols.map((s,i)=>[s,arrays[i]?[...arrays[i]]:arrays[i]]));
  if(arrays.some(a=>!Array.isArray(a)||a.length<2)||arrays.some(a=>a.length!==arrays[0].length)||arrays.some(a=>!a.every(Number.isFinite)))
    throw new TypeError("correlation stress requires finite, equal-length dailyReturns for every asset");
  const common=arrays[0].map((_,i)=>arrays.reduce((sum,a)=>sum+a[i],0)/arrays.length);
  return Object.fromEntries(symbols.map((s,i)=>[s,arrays[i].map((v,j)=>(1-blend)*v+blend*common[j])]));
}
function shockedInput(input,scenario) {
  const assets={};
  for(const [symbol,asset] of Object.entries(input.assets)){
    const initialFactor=1+(scenario.shocks[symbol]??0)/100;
    assets[symbol]={...asset,
      bars:asset.bars.map((bar,index)=>{
        if(index<scenario.shockIndex)return {...bar};
        let factor=initialFactor;
        if(scenario.recoveryEndIndex!=null&&index>=scenario.recoveryEndIndex)factor=1;
        else if(scenario.recoveryEndIndex!=null){
          const progress=(index-scenario.shockIndex)/(scenario.recoveryEndIndex-scenario.shockIndex);
          factor=initialFactor+(1-initialFactor)*progress;
        }
        return {...bar,o:bar.o*factor,h:bar.h*factor,l:bar.l*factor,c:bar.c*factor};
      }),
      signals:asset.signals.map(s=>({...s,plan:{...s.plan}}))
    };
  }
  const returns=stressReturns(assets,scenario.correlationBlend??0);
  for(const symbol of Object.keys(assets))assets[symbol].dailyReturns=returns[symbol];
  return {...input,assets};
}
export function runPortfolioStress(input,scenarios,runner=runPortfolioBacktest){
  if(!input||!input.assets||typeof input.assets!=="object"||Array.isArray(input.assets))throw new TypeError("portfolio input with assets is required");
  if(!Array.isArray(scenarios)||!scenarios.length)throw new TypeError("at least one stress scenario is required");
  if(typeof runner!=="function")throw new TypeError("runner must be a function");
  const symbols=Object.keys(input.assets);
  if(!symbols.length)throw new TypeError("at least one asset is required");
  const barCount=input.assets[symbols[0]]?.bars?.length;
  if(!Number.isInteger(barCount)||barCount<2)throw new TypeError("assets require aligned bars");
  const timestamps=input.assets[symbols[0]].bars.map(b=>b?.t);
  for(const symbol of symbols){
    const bars=input.assets[symbol]?.bars;
    if(!Array.isArray(bars)||bars.length!==barCount||bars.some((b,i)=>!b||![b.t,b.o,b.h,b.l,b.c].every(Number.isFinite)||b.o<=0||b.h<=0||b.l<=0||b.c<=0||b.h<Math.max(b.o,b.c,b.l)||b.l>Math.min(b.o,b.c,b.h)||b.t!==timestamps[i]))
      throw new RangeError("stress input assets require aligned, valid OHLC bars");
  }
  const names=new Set();
  const results=scenarios.map(scenario=>{
    validateScenario(scenario,symbols,barCount);
    if(names.has(scenario.name))throw new RangeError("stress scenario names must be unique");
    names.add(scenario.name);
    const transformed=shockedInput(input,scenario),result=runner(transformed);
    if(!result||!Number.isFinite(result.endingEquity)||!Number.isFinite(result.maxDrawdownPct))throw new TypeError("portfolio runner returned an invalid stress result");
    return {name:scenario.name,shockIndex:scenario.shockIndex,recoveryEndIndex:scenario.recoveryEndIndex??null,
      shocks:{...scenario.shocks},correlationBlend:scenario.correlationBlend??0,
      correlation:correlationSummary(transformed.assets),endingEquity:result.endingEquity,
      netReturnPct:result.netReturnPct,maxDrawdownPct:result.maxDrawdownPct,tradeCount:result.tradeCount,
      openPositionCount:result.openPositions?.length??0,skippedCount:result.skipped?.length??0,
      drawdownState:result.assumptions?.drawdownGuard?.state??"UNKNOWN"};
  });
  return {status:"COMPLETE",scenarioCount:results.length,
    baseline:{endingEquity:input.initialCapital??10000,note:"initial capital before stress; compare with scenario ending equity"},
    results,assumptions:{
      shockModel:"multiplicative OHLC price shock from shockIndex onward",
      recoveryModel:"optional linear return to baseline price factor at recoveryEndIndex",
      correlationModel:"asset returns blended toward equal-weight cross-asset mean; blend=1 creates a common return series",
      signals:"held fixed to isolate price-path and portfolio-risk response",
      limitations:"does not model order-book liquidity, market impact, exchange outages, delistings, or endogenous signal changes"}};
}
