import test from "node:test";
import assert from "node:assert/strict";
import { runUntouchedHoldout } from "../src/backtest/untouched-holdout.js";

const bars=Array.from({length:12},(_,i)=>({t:1000+i*1000,o:100,h:102,l:99,c:101}));
const input={bars,signals:[0,2,4,6,8,10].map(index=>({index,plan:{entry:100,stop:95,tp1:105,tp2:110,tp3:115}}))};
const runner=sample=>({netReturnPct:sample.riskPct*2,maxDrawdownPct:3,tradeCount:sample.signals.length,profitFactor:1.4,endingEquity:10200});
test("runs a locked holdout once with frozen parameters and no candidate selection",()=>{
 let calls=0;
 const result=runUntouchedHoldout(input,{runner:sample=>{calls++;assert.equal(sample.riskPct,0.5);assert.equal(sample.bars[0].t,7000);return runner(sample);},
  start:6,end:12,frozenParameters:{riskPct:.5},selectionLocked:true,selectionTimestamp:6000});
 assert.equal(calls,1);assert.equal(result.status,"COMPLETE");
 assert.equal(result.result.netReturnPct,1);assert.equal(result.holdout.startTimestamp,7000);
});
test("blocks unlocked, undated, overlapping, and invalid holdout requests",()=>{
 assert.throws(()=>runUntouchedHoldout(input,{runner,start:6,end:12,frozenParameters:{},selectionLocked:false,selectionTimestamp:6000}),/selection must be locked/);
 assert.throws(()=>runUntouchedHoldout(input,{runner,start:6,end:12,frozenParameters:{},selectionLocked:true}),TypeError);
 assert.throws(()=>runUntouchedHoldout(input,{runner,start:5,end:12,frozenParameters:{},selectionLocked:true,selectionTimestamp:6000}),RangeError);
 assert.throws(()=>runUntouchedHoldout(input,{runner,start:6,end:20,frozenParameters:{},selectionLocked:true,selectionTimestamp:6000}),RangeError);
});
test("rejects invalid runner metrics and preserves original input",()=>{
 const before=structuredClone(input);
 assert.throws(()=>runUntouchedHoldout(input,{runner:()=>({}),start:6,end:12,frozenParameters:{},selectionLocked:true,selectionTimestamp:6000}),TypeError);
 runUntouchedHoldout(input,{runner,start:6,end:12,frozenParameters:{},selectionLocked:true,selectionTimestamp:6000});
 assert.deepEqual(input,before);
});
