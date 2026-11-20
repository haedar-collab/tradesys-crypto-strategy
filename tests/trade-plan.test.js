import test from "node:test";
import assert from "node:assert/strict";
import { buildLongPlan, advanceLongPosition } from "../src/risk/trade-plan.js";

test("builds a long plan with bounded ATR stop and three profit targets",()=>{
 const p=buildLongPlan({zone:{lo:95,hi:97},atr:2,price:100,targetLevels:[102,106,110]},{stopAtr:1,atrMin:.5,atrMax:3,minRR:1.5});
 assert.equal(p.status,"READY");
 assert.equal(p.entry,96);
 assert.equal(p.stop,93);
 assert.equal(p.tp1,102);
 assert.equal(p.tp2,106);
 assert.equal(p.tp3,110);
 assert.equal(p.rr,10/3);
 assert.deepEqual(p.scaleOut,{tp1:.4,tp2:.4,tp3:.2});
});

test("falls back to measured-move targets when no external resistance is supplied",()=>{
 const p=buildLongPlan({zone:{lo:95,hi:97},atr:2,price:96},{stopAtr:1,atrMin:.5,atrMax:3});
 assert.equal(p.status,"READY");
 assert.ok(p.tp1>p.entry&&p.tp2>p.tp1&&p.tp3>p.tp2);
});

test("rejects plans whose planned reward-to-risk is below minimum",()=>{
 const p=buildLongPlan({zone:{lo:95,hi:97},atr:2,price:100,targetLevels:[96.5]},{minRR:5});
 assert.equal(p.status,"WAIT");
 assert.ok(p.reasons.includes("PLANNED_RR_BELOW_MINIMUM"));
});

test("prioritizes stop when stop and target are both touched in the same OHLC bar",()=>{
 const p={entry:100,stop:95,tp1:105,tp2:110,tp3:115,stage:0,remaining:1,status:"OPEN"};
 const r=advanceLongPosition(p,{low:94,high:106});
 assert.equal(r.status,"CLOSED");
 assert.deepEqual(r.exits,[{fraction:1,price:95,reason:"STOP_LOSS"}]);
});

test("takes 40 percent at TP1 and moves stop to breakeven",()=>{
 const p={entry:100,stop:95,tp1:105,tp2:110,tp3:115,stage:0,remaining:1,status:"OPEN"};
 const r=advanceLongPosition(p,{low:99,high:106});
 assert.equal(r.stage,1);
 assert.equal(r.stop,100);
 assert.equal(r.remaining,.6);
 assert.deepEqual(r.exits,[{fraction:.4,price:105,reason:"TP1"}]);
});

test("scales out TP1 TP2 and TP3 according to the fixed plan",()=>{
 let p={entry:100,stop:95,tp1:105,tp2:110,tp3:115,stage:0,remaining:1,status:"OPEN"};
 p=advanceLongPosition(p,{low:99,high:106});
 p=advanceLongPosition(p,{low:100,high:111});
 p=advanceLongPosition(p,{low:110,high:116});
 assert.equal(p.status,"CLOSED");
 assert.equal(p.remaining,0);
 assert.deepEqual(p.exits,[{fraction:.2,price:115,reason:"TP3"}]);
});

test("rejects malformed OHLC bars",()=>{
 assert.equal(advanceLongPosition({entry:100,stop:95,tp1:105,tp2:110,tp3:115},{low:110,high:105}).status,"WAIT_DATA");
});
