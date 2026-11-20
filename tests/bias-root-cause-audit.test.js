import test from "node:test";
import assert from "node:assert/strict";
import { auditBiasRootCause } from "../src/integration/bias-root-cause-audit.js";

test("summarizes bias and upstream gate distributions without changing rows", () => {
  const rows = [
    {contextReady:true,weekly:"Neutral",daily:"Neutral",regime:{effective:"Downtrend"},h4Structure:"Bearish",gate:"DAILY_BIAS_NOT_BULLISH"},
    {contextReady:true,weekly:"Bullish",daily:"Bullish",regime:{effective:"Uptrend"},h4Structure:"Bullish",gate:"NO_VALID_DEMAND_ZONE"},
    {contextReady:false,gate:"TIMEFRAME_NOT_READY"}
  ];
  const before = structuredClone(rows);
  const result = auditBiasRootCause(rows);
  assert.equal(result.status,"COMPLETE");
  assert.equal(result.evaluationCount,3);
  assert.equal(result.contextReadyCount,2);
  assert.equal(result.distributions.daily.Neutral,1);
  assert.equal(result.distributions.reasons.DAILY_BIAS_NOT_BULLISH,1);
  assert.equal(result.nonBullishContextCount,1);
  assert.deepEqual(rows,before);
});
test("rejects empty input", () => assert.throws(() => auditBiasRootCause([]), /non-empty/));
