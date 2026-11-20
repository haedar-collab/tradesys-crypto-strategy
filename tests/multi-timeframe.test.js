import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMultiTimeframeSetup, STRATEGY_ENGINE_VERSION } from "../src/engine/multi-timeframe.js";

function h4Series() {
  const n=40, o=Array(n).fill(100), c=Array(n).fill(100), h=Array(n).fill(101), l=Array(n).fill(99);
  return {n,t:Array.from({length:n},(_,i)=>i),o,c,h,l,atr:Array(n).fill(1)};
}
function h1Series() {
  const n=80, o=Array(n).fill(96), c=Array(n).fill(96), h=Array(n).fill(96.4), l=Array(n).fill(95.8);
  l[70]=95.9; h[68]=96.5;
  for(let i=72;i<n;i++){o[i]=97;c[i]=97.5;h[i]=98;l[i]=96.8;}
  return {n,t:Array.from({length:n},(_,i)=>i),ct:Array.from({length:n},(_,i)=>i),o,c,h,l,atr:Array(n).fill(.5),piv:{hi:[68],lo:[66]}};
}
function context(overrides={}) {
  return {
    weekly:{closed:true,trend:"Bullish"},
    daily:{bias:"Bullish"},
    regime:{raw:"Uptrend",effective:"Uptrend",confirmed:true},
    h4:{
      price:96.5,close:96.5,atr:1,trend:"Bullish",rangeEquilibrium:99,
      series:h4Series(),
      orderBlocks:[{lo:95,hi:97,idx:10,from:11,t:10}],
      fvgs:[{lo:96,hi:96.5,idx:12}],
      targetLevels:[100,105,110],
      rejection:false
    },
    h1:{series:h1Series()},
    ...overrides
  };
}

test("blocks provisional weekly and unconfirmed regime contexts before any entry analysis",()=>{
  assert.ok(evaluateMultiTimeframeSetup(context({weekly:{closed:false,trend:"Bullish"}})).reasons.includes("WEEKLY_CONTEXT_PROVISIONAL"));
  assert.ok(evaluateMultiTimeframeSetup(context({regime:{raw:"Downtrend",effective:"Uptrend",confirmed:false}})).reasons.includes("MARKET_REGIME_UNCONFIRMED"));
});

test("blocks bearish higher-timeframe context",()=>{
  assert.ok(evaluateMultiTimeframeSetup(context({weekly:{closed:true,trend:"Bearish"}})).reasons.includes("WEEKLY_BIAS_BEARISH"));
  assert.ok(evaluateMultiTimeframeSetup(context({daily:{bias:"Neutral"}})).reasons.includes("DAILY_BIAS_NOT_BULLISH"));
  assert.ok(evaluateMultiTimeframeSetup(context({regime:{raw:"Downtrend",effective:"Downtrend",confirmed:true}})).reasons.includes("MARKET_REGIME_DOWNTREND"));
});

test("returns WAIT when no valid demand zone or 1H data is available",()=>{
  const noZone=context({h4:{...context().h4,orderBlocks:[],fvgs:[]}});
  assert.ok(evaluateMultiTimeframeSetup(noZone).reasons.includes("NO_VALID_DEMAND_ZONE"));
  const noH1=context({h1:null});
  assert.ok(evaluateMultiTimeframeSetup(noH1).reasons.includes("1H_TRIGGER_DATA_UNAVAILABLE"));
});

test("orchestrates weekly, daily, regime, 4H demand zone and confirmed 1H trigger",()=>{
  const result=evaluateMultiTimeframeSetup(context(),{blockWeakZones:false,minRR:1.5});
  assert.equal(result.strategyVersion,STRATEGY_ENGINE_VERSION);
  assert.equal(result.status,"BUY_CANDIDATE");
  assert.equal(result.candidate,true);
  assert.equal(result.timeframeEvidence.weekly,"Bullish");
  assert.equal(result.timeframeEvidence.daily,"Bullish");
  assert.equal(result.timeframeEvidence.trigger1h,"1H BOS");
  assert.equal(result.plan.tp2,105);
  assert.match(result.disclaimer,/No order execution/);
});
