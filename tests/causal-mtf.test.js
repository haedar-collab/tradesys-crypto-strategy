import test from "node:test";
import assert from "node:assert/strict";
import { buildCausalMultiTimeframeContext,evaluateCausalMultiTimeframeSetup,CAUSAL_MTF_INTERVALS,classifyContextBias } from "../src/engine/causal-mtf.js";

const now=Date.UTC(2026,10,20,12,0,0);
function series(key,count,interval){
 let anchor;
 if(key==="weekly"){
  const d=new Date(now);const day=(d.getUTCDay()+6)%7;
  anchor=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-day*86400000-interval;
 }else if(key==="daily"){
  anchor=Date.UTC(new Date(now).getUTCFullYear(),new Date(now).getUTCMonth(),new Date(now).getUTCDate())-interval;
 }else anchor=Math.floor(now/interval)*interval-interval;
 return Array.from({length:count},(_,i)=>{
  const openTime=anchor-(count-1-i)*interval;
  const close=100+i*.08+Math.sin(i/6);
  return {openTime,closeTime:openTime+interval-1,open:close-.1,high:close+.7,low:close-.7,close,volume:1000+(i%9)*10,quoteVolume:100000};
 });
}
function input(){
 return {
  weekly:series("weekly",230,CAUSAL_MTF_INTERVALS.weekly),
  daily:series("daily",230,CAUSAL_MTF_INTERVALS.daily),
  h4:series("h4",90,CAUSAL_MTF_INTERVALS.h4),
  h1:series("h1",90,CAUSAL_MTF_INTERVALS.h1)
 };
}
test("builds Weekly/Daily/4H/1H contexts only from closed candles as of evaluation time",()=>{
 const built=buildCausalMultiTimeframeContext(input(),{evaluationTime:now});
 assert.equal(built.status,"READY");
 for(const key of ["weekly","daily","h4","h1"]){
  assert.equal(built.context[key].closed,true);
  assert.ok(built.context[key].asOf<now);
  assert.equal(built.metadata.closedCandleCounts[key],key==="weekly"||key==="daily"?230:90);
 }
 assert.equal(built.temporal.status,"PASS");
 assert.equal(built.context.h1.series.ct.length,90);
});
test("excludes forming candles and does not let their prices alter the closed context",()=>{
 const original=input(),withForming=input();
 for(const key of Object.keys(withForming)){
  const last=withForming[key].at(-1);
  const interval=CAUSAL_MTF_INTERVALS[key];
  const openTime=Math.floor(now/interval)*interval;
  withForming[key].push({...last,openTime,closeTime:openTime+interval-1,open:900,high:999,low:800,close:950});
 }
 const a=buildCausalMultiTimeframeContext(original,{evaluationTime:now});
 const b=buildCausalMultiTimeframeContext(withForming,{evaluationTime:now});
 assert.equal(a.status,"READY");assert.equal(b.status,"READY");
 for(const key of ["weekly","daily","h4","h1"]){
  assert.equal(a.context[key].asOf,b.context[key].asOf);
 }
 assert.equal(a.context.h4.price,b.context.h4.price);
 assert.equal(a.context.h1.series.c.at(-1),b.context.h1.series.c.at(-1));
});
test("blocks insufficient, malformed, or out-of-order timeframe data",()=>{
 const tooShort=input();tooShort.h1=tooShort.h1.slice(0,20);
 const short=buildCausalMultiTimeframeContext(tooShort,{evaluationTime:now});
 assert.equal(short.status,"WAIT");assert.equal(short.timeframe,"h1");
 const malformed=input();malformed.h4[10].high=1;
 assert.equal(buildCausalMultiTimeframeContext(malformed,{evaluationTime:now}).status,"WAIT");
 const unordered=input();[unordered.daily[3],unordered.daily[4]]=[unordered.daily[4],unordered.daily[3]];
 assert.equal(buildCausalMultiTimeframeContext(unordered,{evaluationTime:now}).status,"WAIT");
});
test("requires explicit evaluation timestamp and returns a guarded strategy decision",()=>{
 assert.throws(()=>buildCausalMultiTimeframeContext(input(),{}),TypeError);
 const result=evaluateCausalMultiTimeframeSetup(input(),{evaluationTime:now});
 assert.ok(["WAIT","BUY_CANDIDATE"].includes(result.status));
 assert.equal(result.contextBuild.status,"READY");
 assert.equal(result.contextBuild.temporal.status,"PASS");
});

test("classifies conflicting EMA and structure evidence as Mixed, not Neutral",()=>{
 assert.equal(classifyContextBias(-1,110,100),"Mixed");
 assert.equal(classifyContextBias(1,90,100),"Mixed");
 assert.equal(classifyContextBias(-1,90,100),"Bearish");
 assert.equal(classifyContextBias(1,110,100),"Bullish");
 assert.equal(classifyContextBias(0,110,100),"Neutral");
 assert.equal(classifyContextBias(-1,null,100),"Neutral");
});
