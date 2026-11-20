import test from "node:test";
import assert from "node:assert/strict";
import { evaluateStrategyAcceptance } from "../src/validation/strategy-acceptance.js";

const passingReport = () => ({
 dataQuality:{status:"PASS"},
 outOfSample:{tradeCount:180,profitFactor:1.55,netReturnPct:18,maxDrawdownPct:12},
 walkForward:{folds:[{netReturnPct:4},{netReturnPct:2},{netReturnPct:-1},{netReturnPct:3},{netReturnPct:1}]},
 regimeAnalysis:{groups:[
  {regime:"BULLISH_NORMAL",tradeCount:65,meanNetReturnPct:0.8},
  {regime:"BEARISH_NORMAL",tradeCount:55,meanNetReturnPct:0.4},
  {regime:"SIDEWAYS_NORMAL",tradeCount:60,meanNetReturnPct:0.2}
 ]},
 costStress:{profitFactor:1.12,netReturnPct:4},
 blockBootstrap:{maxDrawdownPct:{p95:22}},
 evaluatedAt:"2026-11-20T00:00:00.000Z"
});

test("accepts complete evidence only when every hard gate passes",()=>{
 const result=evaluateStrategyAcceptance(passingReport());
 assert.equal(result.decision,"ACCEPT");
 assert.equal(result.eligibleForPaperTrading,true);
 assert.equal(result.summary.failed,0);
 assert.equal(result.summary.pending,0);
});

test("missing evidence is CONDITIONAL and never accepted",()=>{
 const result=evaluateStrategyAcceptance({dataQuality:{status:"PASS"}});
 assert.equal(result.decision,"CONDITIONAL");
 assert.equal(result.eligibleForPaperTrading,false);
 assert.ok(result.missingEvidence.length>0);
});

test("hard out-of-sample failure produces REJECT",()=>{
 const report=passingReport();
 report.outOfSample.profitFactor=0.95;
 const result=evaluateStrategyAcceptance(report);
 assert.equal(result.decision,"REJECT");
 assert.ok(result.failures.includes("oos_profit_factor"));
});

test("weak stressed execution economics produces REJECT",()=>{
 const report=passingReport();
 report.costStress={profitFactor:0.8,netReturnPct:-2};
 const result=evaluateStrategyAcceptance(report);
 assert.equal(result.decision,"REJECT");
 assert.ok(result.failures.includes("stressed_profit_factor"));
 assert.ok(result.failures.includes("stressed_net_return"));
});

test("underpowered regime evidence remains CONDITIONAL",()=>{
 const report=passingReport();
 report.regimeAnalysis.groups[0].tradeCount=5;
 const result=evaluateStrategyAcceptance(report);
 assert.equal(result.decision,"CONDITIONAL");
 assert.ok(result.missingEvidence.includes("regime_sample_size"));
});

test("insufficient positive folds is rejected",()=>{
 const report=passingReport();
 report.walkForward.folds=[{netReturnPct:1},{netReturnPct:-1},{netReturnPct:-2}];
 const result=evaluateStrategyAcceptance(report);
 assert.equal(result.decision,"REJECT");
 assert.ok(result.failures.includes("positive_fold_ratio"));
});

test("rejects invalid thresholds and malformed report",()=>{
 assert.throws(()=>evaluateStrategyAcceptance(null),/report object/);
 assert.throws(()=>evaluateStrategyAcceptance(passingReport(),{maxDrawdownPct:101}),/maxDrawdownPct/);
});
