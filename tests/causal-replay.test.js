import test from "node:test";
import assert from "node:assert/strict";
import { runCausalReplay,runCausalFeatureReplay,runCausalSignalReplay,assertCausalPrefixInvariant } from "../src/backtest/causal-replay.js";

function barsOf(n=240){
 return Array.from({length:n},(_,i)=>{
  const c=100+i*.12+Math.sin(i/5)*2;
  return {t:1_700_000_000_000+i*3_600_000,o:c-.2,h:c+.8,l:c-.8,c,v:1000+(i%11)*25};
 });
}
test("replay evaluator receives only the closed prefix and cannot mutate it",()=>{
 const bars=barsOf(12);
 const result=runCausalReplay(bars,ctx=>{
  assert.equal(ctx.bars.length,ctx.index+1);
  assert.equal(ctx.asOf,ctx.bars.at(-1).t);
  assert.equal(Object.isFrozen(ctx.bars),true);
  assert.equal(Object.isFrozen(ctx.bars.at(-1)),true);
  assert.throws(()=>ctx.bars.push({}),TypeError);
  return {seen:ctx.bars.length,lastClose:ctx.bars.at(-1).c};
 },{warmupBars:3});
 assert.equal(result.replayedBars,10);
 assert.equal(result.outputs[0].index,2);
 assert.equal(result.outputs.at(-1).result.seen,12);
});
test("future candle mutations cannot change any earlier causal replay output",()=>{
 const bars=barsOf(20);
 const check=assertCausalPrefixInvariant(bars,ctx=>({
  meanClose:ctx.bars.reduce((s,b)=>s+b.c,0)/ctx.bars.length,
  maxHigh:Math.max(...ctx.bars.map(b=>b.h))
 }),12,{warmupBars:3});
 assert.equal(check.status,"PASS");
 assert.equal(check.unchangedOutputs,10);
});
test("rejects malformed OHLCV, unordered timestamps, and invalid warmup",()=>{
 const bars=barsOf(8);
 assert.throws(()=>runCausalReplay(bars.slice(0,1),()=>null),TypeError);
 const unordered=bars.map(b=>({...b}));unordered[4].t=unordered[3].t;
 assert.throws(()=>runCausalReplay(unordered,()=>null),RangeError);
 const invalid=bars.map(b=>({...b}));invalid[3].h=invalid[3].l-1;
 assert.throws(()=>runCausalReplay(invalid,()=>null),RangeError);
 assert.throws(()=>runCausalReplay(bars,()=>null,{warmupBars:1}),RangeError);
});
test("causal feature replay computes indicators, structure, zones and regime from each prefix",()=>{
 const bars=barsOf(230);
 const replay=runCausalFeatureReplay(bars,{warmupBars:210});
 assert.equal(replay.status,"COMPLETE");
 assert.equal(replay.outputs.length,21);
 for(const row of replay.outputs){
  assert.equal(row.asOf,row.result.timestamp);
  assert.ok(row.result.indicators);
  assert.ok(row.result.structure);
  assert.ok(Array.isArray(row.result.orderBlocks));
  assert.ok(Array.isArray(row.result.fvgs));
  assert.ok(row.result.regime);
 }
});
test("feature replay is invariant to future-only candle changes",()=>{
 const bars=barsOf(225);
 const evaluate=ctx=>{
  const result=runCausalFeatureReplay(ctx.bars,{warmupBars:210});
  return result.outputs.at(-1)?.result??null;
 };
 const check=assertCausalPrefixInvariant(bars,evaluate,220,{warmupBars:210});
 assert.equal(check.status,"PASS");
});

test("causal signal replay builds a decision from each prefix-only feature snapshot",()=>{
 const bars=barsOf(220);
 const replay=runCausalSignalReplay(bars,ctx=>{
  assert.equal(ctx.bars.length,ctx.index+1);
  assert.equal(ctx.asOf,ctx.bars.at(-1).t);
  return {timestamp:ctx.asOf,close:ctx.bars.at(-1).c,featureTimestamp:ctx.features.timestamp};
 },input=>({status:"WAIT",candidate:false,asOf:input.timestamp,featureTimestamp:input.featureTimestamp}),{warmupBars:210});
 assert.equal(replay.outputs.length,11);
 for(const row of replay.outputs){
  assert.equal(row.result.decision.asOf,row.asOf);
  assert.equal(row.result.decision.featureTimestamp,row.asOf);
 }
});
