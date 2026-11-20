import test from "node:test";
import assert from "node:assert/strict";
import { analyzeFilterGates } from "../src/integration/filter-gate-analysis.js";

test("reports overlapping independent blockers and ordered first blocker", () => {
  const rows = [
    {contextReady:true,weekly:"Neutral",daily:"Neutral",regime:{confirmed:true,effective:"Downtrend"},h4Structure:"Bearish"},
    {contextReady:true,weekly:"Bullish",daily:"Bullish",regime:{confirmed:true,effective:"Uptrend"},h4Structure:"Bullish"},
    {contextReady:false,gate:"TIMEFRAME_NOT_READY"}
  ];
  const result = analyzeFilterGates(rows);
  assert.equal(result.evaluationCount,3);
  assert.equal(result.contextReadyCount,2);
  assert.equal(result.independentBlockers.dailyNotBullish,1);
  assert.equal(result.independentBlockers.regimeDowntrend,1);
  assert.equal(result.independentBlockers.h4NotBullish,1);
  assert.equal(result.firstBlockerCounts.dailyNotBullish,1);
  assert.equal(result.firstBlockerCounts.passed_observed_gates,1);
  assert.equal(result.firstBlockerCounts.TIMEFRAME_NOT_READY,1);
});
test("rejects empty input",()=>assert.throws(()=>analyzeFilterGates([]),/non-empty/));
