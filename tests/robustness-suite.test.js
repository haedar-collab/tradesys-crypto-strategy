import test from "node:test";
import assert from "node:assert/strict";
import { runParameterSensitivity, runTradeSequenceMonteCarlo } from "../src/backtest/robustness-suite.js";

test("parameter sensitivity runs isolated one-factor scenarios",()=>{
 const input={risk:{riskPct:1},bars:[1,2,3]};
 const before=structuredClone(input);
 const result=runParameterSensitivity(x=>({netReturnPct:x.risk.riskPct*2,endingEquity:1000+x.risk.riskPct,maxDrawdownPct:5,tradeCount:12}),input,{"risk.riskPct":[.5,1,1.5]});
 assert.equal(result.scenarioCount,3);
 assert.deepEqual(result.results.map(x=>x.value),[.5,1,1.5]);
 assert.deepEqual(input,before);
});

test("parameter sensitivity rejects unknown paths and invalid runner outputs",()=>{
 assert.throws(()=>runParameterSensitivity(()=>({}),{risk:{x:1}},{"risk.x":[1]}),/finite/);
 assert.throws(()=>runParameterSensitivity(()=>({netReturnPct:1,endingEquity:1,maxDrawdownPct:1}),{risk:{}},{"risk.missing":[1]}),/unknown parameter/);
});

test("Monte Carlo is deterministic for a fixed seed",()=>{
 const args={tradeReturns:[.02,-.01,.03,-.02,.01],initialCapital:1000,simulations:500,tradesPerSimulation:20,seed:77};
 const a=runTradeSequenceMonteCarlo(args),b=runTradeSequenceMonteCarlo(args);
 assert.deepEqual(a,b);
 assert.equal(a.simulations,500);
 assert.ok(a.probabilityOfLoss>=0&&a.probabilityOfLoss<=1);
 assert.ok(a.maxDrawdownPct.p99>=a.maxDrawdownPct.p95);
});

test("Monte Carlo rejects invalid return samples and configuration",()=>{
 assert.throws(()=>runTradeSequenceMonteCarlo({tradeReturns:[-.1,-1]}),RangeError);
 assert.throws(()=>runTradeSequenceMonteCarlo({tradeReturns:[.1],simulations:10}),RangeError);
 assert.throws(()=>runTradeSequenceMonteCarlo({tradeReturns:[]}),TypeError);
});
