import test from "node:test";
import assert from "node:assert/strict";
import { runWalkForward } from "../src/backtest/walk-forward.js";

const bars=Array.from({length:12},(_,i)=>({t:i,o:100+i,h:102+i,l:99+i,c:101+i}));
const input={bars,signals:[0,2,4,6,8,10].map(index=>({index,plan:{entry:100,stop:95,tp1:105,tp2:110,tp3:115}})),initialCapital:10000};
const runner=sample=>({
 status:"COMPLETE",
 netReturnPct:sample.multiplier+(sample.bars[0].t>=6?1:0),
 maxDrawdownPct:2,tradeCount:sample.signals.length,endingEquity:10000
});
test("selects parameters on training data and evaluates them on a later untouched test slice",()=>{
 const seen=[];
 const result=runWalkForward(input,{
  runner:sample=>{seen.push({first:sample.bars[0].t,last:sample.bars.at(-1).t,multiplier:sample.multiplier,signalIndices:sample.signals.map(s=>s.index)});return runner(sample);},
  parameterCandidates:[{multiplier:1},{multiplier:3}],
  windows:[{name:"wf-1",trainStart:0,trainEnd:6,testStart:6,testEnd:12}]
 });
 assert.equal(result.status,"COMPLETE");
 assert.deepEqual(result.results[0].selectedParameters,{multiplier:3});
 assert.equal(result.results[0].selectedTrainingMetric,3);
 assert.equal(result.results[0].outOfSample.selectionMetricValue,4);
 assert.equal(seen[0].first,0);assert.equal(seen[0].last,5);
 assert.equal(seen[2].first,6);assert.equal(seen[2].last,11);
 assert.ok(seen[2].signalIndices.every(i=>i<5));
});
test("does not allow overlapping training and out-of-sample periods",()=>{
 assert.throws(()=>runWalkForward(input,{runner,parameterCandidates:[{}],windows:[{name:"bad",trainStart:0,trainEnd:7,testStart:6,testEnd:12}]}),RangeError);
});
test("supports multiple sequential windows with independent training selection",()=>{
 const result=runWalkForward(input,{runner,parameterCandidates:[{multiplier:1},{multiplier:2}],
  windows:[{name:"first",trainStart:0,trainEnd:4,testStart:4,testEnd:8},{name:"second",trainStart:2,trainEnd:8,testStart:8,testEnd:12}]});
 assert.equal(result.windowCount,2);
 assert.equal(result.results[0].selectedParameters.multiplier,2);
 assert.equal(result.results[1].selectedParameters.multiplier,2);
});
test("rejects invalid candidates, duplicate window names, and invalid runner metrics",()=>{
 assert.throws(()=>runWalkForward(input,{runner,parameterCandidates:[],windows:[{name:"a",trainStart:0,trainEnd:4,testStart:4,testEnd:8}]}),TypeError);
 assert.throws(()=>runWalkForward(input,{runner,parameterCandidates:[{}],windows:[{name:"a",trainStart:0,trainEnd:4,testStart:4,testEnd:8},{name:"a",trainStart:0,trainEnd:4,testStart:4,testEnd:8}]}),TypeError);
 assert.throws(()=>runWalkForward(input,{runner:()=>({}),parameterCandidates:[{}],windows:[{name:"a",trainStart:0,trainEnd:4,testStart:4,testEnd:8}]}),TypeError);
});
test("supports aligned multi-asset portfolio input and slices every asset identically",()=>{
 const portfolio={assets:{
  AAAUSDT:{bars,signals:input.signals,dailyReturns:[.01,.02,.03]},
  BBBUSDT:{bars,signals:[],dailyReturns:[.02,.01,.03]}
 }};
 const result=runWalkForward(portfolio,{runner:sample=>{
  assert.equal(sample.assets.AAAUSDT.bars.length,4);
  assert.equal(sample.assets.BBBUSDT.bars.length,4);
  return {netReturnPct:sample.multiplier,maxDrawdownPct:1,tradeCount:0,endingEquity:10000};
 },parameterCandidates:[{multiplier:1},{multiplier:2}],
 windows:[{name:"portfolio-wf",trainStart:0,trainEnd:4,testStart:4,testEnd:8}]});
 assert.equal(result.results[0].outOfSample.netReturnPct,2);
});
