import test from "node:test";
import assert from "node:assert/strict";
import { validateMultiTimeframeAsOf } from "../src/validation/timeframes.js";

const now=Date.UTC(2026,10,20,12);
const context={
 weekly:{closed:true,asOf:now-2*86_400_000},
 daily:{closed:true,asOf:now-86_400_000},
 h4:{closed:true,asOf:now-4*3_600_000},
 h1:{closed:true,asOf:now-3_600_000}
};
test("accepts closed and fresh contexts within configured timeframe age limits",()=>{
 assert.equal(validateMultiTimeframeAsOf(context,{evaluationTime:now}).status,"PASS");
});
test("rejects missing, forming, future-dated, and stale timeframe contexts",()=>{
 const forming=structuredClone(context);forming.h1.closed=false;
 assert.ok(validateMultiTimeframeAsOf(forming,{evaluationTime:now}).errors.some(x=>x.code==="TIMEFRAME_NOT_CLOSED"&&x.timeframe==="h1"));
 const future=structuredClone(context);future.h4.asOf=now+1;
 assert.ok(validateMultiTimeframeAsOf(future,{evaluationTime:now}).errors.some(x=>x.code==="TIMEFRAME_ASOF_IN_FUTURE"));
 const stale=structuredClone(context);stale.h1.asOf=now-3*3_600_000;
 assert.ok(validateMultiTimeframeAsOf(stale,{evaluationTime:now}).errors.some(x=>x.code==="TIMEFRAME_STALE"&&x.timeframe==="h1"));
 const missing=structuredClone(context);delete missing.daily;
 assert.ok(validateMultiTimeframeAsOf(missing,{evaluationTime:now}).errors.some(x=>x.code==="TIMEFRAME_CONTEXT_MISSING"&&x.timeframe==="daily"));
});
test("rejects invalid evaluation time and invalid freshness configuration",()=>{
 assert.equal(validateMultiTimeframeAsOf(context,{}).status,"FAIL");
 assert.ok(validateMultiTimeframeAsOf(context,{evaluationTime:now,maxAgeMs:{h1:0}}).errors.some(x=>x.code==="MAX_AGE_INVALID"));
});
