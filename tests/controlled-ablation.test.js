import test from "node:test";
import assert from "node:assert/strict";
import { runControlledAblation } from "../src/backtest/controlled-ablation.js";
const scenarios = [
 {name:"baseline",config:{role:"baseline",gates:["weekly","daily","regime","h4"]}},
 {name:"without-daily",config:{role:"ablation",gates:["weekly","regime","h4"]}}
];
test("rebuilds each scenario and compares same simulator metrics to baseline",()=>{
 const seen=[];
 const result=runControlledAblation({trainingInput:{bars:[{t:1}],seed:7},scenarios,
  scenarioBuilder:(training,config)=>({bars:training.bars,signals:config.gates.length,config}),
  backtestRunner:input=>{seen.push(input.config.gates.length);return {status:"COMPLETE",netReturnPct:input.signals*2,maxDrawdownPct:3,tradeCount:input.signals,winRatePct:50,endingEquity:10000};}});
 assert.deepEqual(seen,[4,3]); assert.equal(result.scope,"TRAINING_ONLY");
 assert.equal(result.results[0].deltaVsBaseline.netReturnPct,0);
 assert.equal(result.results[1].deltaVsBaseline.netReturnPct,-2);
});
test("requires an explicit baseline",()=>assert.throws(()=>runControlledAblation({
 trainingInput:{},scenarios:[{name:"a",config:{}},{name:"b",config:{}}],scenarioBuilder:()=>({}),
 backtestRunner:()=>({status:"COMPLETE",netReturnPct:0,maxDrawdownPct:0,tradeCount:0})}),/baseline/));
test("rejects invalid simulator output",()=>assert.throws(()=>runControlledAblation({
 trainingInput:{},scenarios:[{name:"base",config:{role:"baseline"}},{name:"alt",config:{}}],
 scenarioBuilder:()=>({}),backtestRunner:()=>({status:"WAIT"})}),/did not complete/));

import { runEventBacktest } from "../src/backtest/event-driven.js";

test("runs controlled scenarios through the actual event-driven simulator", () => {
 const bars = [
  {t:1,o:100,h:101,l:99,c:100},
  {t:2,o:100,h:135,l:95,c:130},
  {t:3,o:130,h:132,l:125,c:130}
 ];
 const scenarios = [
  {name:"baseline",config:{role:"baseline",allowSignal:false}},
  {name:"without-daily",config:{role:"ablation",allowSignal:true}}
 ];
 const result = runControlledAblation({
  trainingInput:{bars},
  scenarios,
  scenarioBuilder:(training,config)=>({bars:training.bars,signals:config.allowSignal?[{
   index:0,plan:{entry:100,stop:90,tp1:110,tp2:120,tp3:130}
  }]:[],feeBps:10,slippageBps:5}),
  backtestRunner:runEventBacktest
 });
 assert.equal(result.scope,"TRAINING_ONLY");
 assert.equal(result.results[0].metrics.tradeCount,0);
 assert.equal(result.results[1].metrics.tradeCount,1);
 assert.ok(Number.isFinite(result.results[1].metrics.netReturnPct));
});
