import test from "node:test";
import assert from "node:assert/strict";
import { runMultiRegimeAblation } from "../src/backtest/multi-regime-ablation.js";

const scenarios = [
 {name:"baseline",config:{role:"baseline",gates:["weekly","daily","regime","h4"]}},
 {name:"without-daily",config:{role:"ablation",gates:["weekly","regime","h4"]}}
];
const bars = n => Array.from({length:n},(_,i)=>({t:i+1,o:100,h:101,l:99,c:100}));
test("runs all three training regimes with the same scenario runner",()=>{
 const result=runMultiRegimeAblation({
  trainingByRegime:{BULLISH:{bars:bars(120)},BEARISH:{bars:bars(120)},SIDEWAYS:{bars:bars(120)}},
  scenarios,minBars:100,minTrades:1,
  scenarioBuilder:({regime,training,config})=>({bars:training.bars,signals:[],regime,config}),
  backtestRunner:input=>({status:"COMPLETE",netReturnPct:0,maxDrawdownPct:0,tradeCount:0,endingEquity:10000})
 });
 assert.equal(result.scope,"TRAINING_ONLY");
 assert.deepEqual(Object.keys(result.regimes),["BULLISH","BEARISH","SIDEWAYS"]);
 assert.equal(result.regimes.BEARISH.warnings.length,2);
});
test("rejects missing regime fold",()=>assert.throws(()=>runMultiRegimeAblation({
 trainingByRegime:{BULLISH:{bars:bars(120)},BEARISH:{bars:bars(120)}},
 scenarios,scenarioBuilder:()=>({}),backtestRunner:()=>({})
}),/exactly BULLISH/));
test("rejects undersized fold",()=>assert.throws(()=>runMultiRegimeAblation({
 trainingByRegime:{BULLISH:{bars:bars(10)},BEARISH:{bars:bars(120)},SIDEWAYS:{bars:bars(120)}},
 scenarios,scenarioBuilder:()=>({}),backtestRunner:()=>({})
}),/fewer than minBars/));
