import test from "node:test";
import assert from "node:assert/strict";
import { runParameterSensitivity } from "../src/backtest/parameter-sensitivity.js";

const input={bars:[{t:1,o:100,h:101,l:99,c:100}],signals:[],riskPct:1};
const runner=sample=>({netReturnPct:4-sample.riskPct*2,maxDrawdownPct:sample.riskPct*3,
 profitFactor:1.5,tradeCount:12,endingEquity:10000+sample.riskPct*100});
test("evaluates each parameter set with identical baseline inputs and reports dispersion",()=>{
 const before=structuredClone(input);
 const r=runParameterSensitivity(runner,input,[{riskPct:.5},{riskPct:1},{riskPct:1.5}]);
 assert.equal(r.status,"COMPLETE");assert.equal(r.scenarioCount,3);
 assert.equal(r.summary.positiveReturnScenarioCount,3);
 assert.equal(r.summary.netReturnRangePct,2);
 assert.equal(r.summary.maxObservedDrawdownPct,4.5);
 assert.deepEqual(input,before);
});
test("reports negative/positive return sign changes as parameter fragility",()=>{
 const r=runParameterSensitivity(sample=>({netReturnPct:sample.threshold===1?2:-1,
 maxDrawdownPct:5}),input,[{threshold:1},{threshold:2}]);
 assert.equal(r.summary.positiveReturnScenarioCount,1);
 assert.equal(r.summary.negativeReturnScenarioCount,1);
});
test("uses selected metric for descriptive ranking without selecting deployment parameters",()=>{
 const r=runParameterSensitivity(sample=>({netReturnPct:sample.riskPct,
 maxDrawdownPct:sample.riskPct*2,profitFactor:1}),input,[{riskPct:.5},{riskPct:1}],{metric:"maxDrawdownPct",direction:"minimize"});
 assert.equal(r.results[r.summary.bestScenarioIndex].parameters.riskPct,.5);
 assert.equal(r.results[r.summary.worstScenarioIndex].parameters.riskPct,1);
 assert.equal(r.assumptions.noOptimization.includes("does not choose"),true);
});
test("rejects malformed scenarios and incomplete backtest metrics",()=>{
 assert.throws(()=>runParameterSensitivity(runner,input,[{riskPct:1}]),TypeError);
 assert.throws(()=>runParameterSensitivity(runner,input,[{riskPct:1},{}],{metric:"unknown"}),TypeError);
 assert.throws(()=>runParameterSensitivity(null,input,[{},{a:1}]),TypeError);
});
