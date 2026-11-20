import test from "node:test";
import assert from "node:assert/strict";
import { classifyBiasEvidence, auditBiasClassification } from "../src/integration/bias-classification-audit.js";

test("mirrors current production bias classification", () => {
  assert.equal(classifyBiasEvidence({eventTrend:0,ema50VsEma200:2}).result, "Neutral");
  assert.equal(classifyBiasEvidence({eventTrend:1,ema50VsEma200:2}).result, "Bullish");
  assert.equal(classifyBiasEvidence({eventTrend:-1,ema50VsEma200:-2}).result, "Bearish");
  assert.equal(classifyBiasEvidence({eventTrend:1,ema50VsEma200:-2}).reason, "STRUCTURE_EMA_DISAGREEMENT");
  assert.equal(classifyBiasEvidence({eventTrend:1,ema50VsEma200:null}).reason, "INSUFFICIENT_BIAS_EVIDENCE");
});

test("audits Weekly and Daily component distributions without changing rows", () => {
  const diagnostics = { rows: [
    {contextReady:true,timeframeEvidence:{
      weekly:{eventTrend:0,ema50VsEma200:1,closeVsEma50:2,closeVsEma200:3},
      daily:{eventTrend:1,ema50VsEma200:1,closeVsEma50:1,closeVsEma200:2}}},
    {contextReady:true,timeframeEvidence:{
      weekly:{eventTrend:-1,ema50VsEma200:-1,closeVsEma50:-1,closeVsEma200:-2},
      daily:{eventTrend:0,ema50VsEma200:-1,closeVsEma50:-1,closeVsEma200:-2}}},
    {contextReady:false}
  ]};
  const before = structuredClone(diagnostics);
  const report = auditBiasClassification(diagnostics);
  assert.equal(report.timeframes.weekly.evaluated, 2);
  assert.deepEqual(report.timeframes.weekly.resultCounts, {Neutral:1,Bearish:1});
  assert.deepEqual(report.timeframes.daily.resultCounts, {Bullish:1,Neutral:1});
  assert.deepEqual(diagnostics, before);
});

test("rejects malformed diagnostics", () => {
  assert.throws(() => auditBiasClassification({}), /diagnostics.rows/);
});
