import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLtfTrigger } from "../src/structure/ltf-trigger.js";

function fixture() {
  const n=60;
  const c=Array(n).fill(100),o=Array(n).fill(100),h=Array(n).fill(101),l=Array(n).fill(100);
  c[50]=98;o[50]=98;h[50]=101;l[50]=98;
  return {n,t:Array.from({length:n},(_,i)=>i*3_600_000),
    ct:Array.from({length:n},(_,i)=>(i+1)*3_600_000-1),
    o,h,l,c,atr:Array(n).fill(2),piv:{hi:[],lo:[]}};
}
const zone={lo:95,hi:99};

test("returns a true OHLC zone intersection without bullish confirmation",()=>{
 const p=fixture();
 const result=evaluateLtfTrigger(p,zone,4);
 assert.equal(result.state,"touch");
 assert.equal(result.zoneState,"TOUCHED");
 assert.equal(result.touchedAt,p.t[50]);
 assert.equal(result.trigger,null);
 assert.equal(result.stop1h,96);
});

test("does not count a candle entirely below the demand zone as a touch",()=>{
 const p=fixture();
 p.l[50]=92;p.h[50]=94;p.c[50]=93;p.o[50]=93;
 const result=evaluateLtfTrigger(p,zone,4);
 assert.equal(result.state,"none");
 assert.equal(result.zoneState,"UNTOUCHED");
 assert.equal(result.touchedAt,null);
});

test("confirms bullish 1H BOS after the zone is touched",()=>{
 const p=fixture();p.piv.hi=[45];p.h[45]=100;p.c[55]=101;p.c[59]=101;
 const result=evaluateLtfTrigger(p,zone,4);
 assert.equal(result.state,"confirmed");assert.equal(result.trigger,"1H BOS");
 assert.equal(result.at,p.t[55]);assert.equal(result.level,100);
});

test("confirms 1H swing-low sweep and reclaim",()=>{
 const p=fixture();p.piv.lo=[50];p.l[50]=97.5;p.l[51]=97;p.o[51]=97.8;p.c[51]=98;p.c[59]=98;
 const result=evaluateLtfTrigger(p,zone,4);
 assert.equal(result.state,"confirmed");assert.equal(result.trigger,"1H sweep + reclaim");
 assert.equal(result.level,97.5);assert.equal(result.at,p.t[51]);
 assert.equal(result.zoneState,"RECLAIMED");
});

test("records a wick below the zone followed by a close back above as reclaim",()=>{
 const p=fixture();p.l[50]=94;p.h[50]=98;p.c[50]=96;p.o[50]=97;
 const result=evaluateLtfTrigger(p,zone,4);
 assert.equal(result.state,"touch");assert.equal(result.zoneState,"RECLAIMED");
 assert.equal(result.reclaimed,true);
});

test("marks the zone broken on any close below the invalidation buffer in lookback",()=>{
 const p=fixture();p.c[55]=94.5;p.l[55]=94;p.c[59]=98;
 const result=evaluateLtfTrigger(p,zone,4);
 assert.equal(result.state,"broken");assert.equal(result.zoneState,"BROKEN");
 assert.equal(result.invalidatedAt,p.t[55]);
});

test("a stale zone touch outside the 12-bar observation window is ignored",()=>{
 const p=fixture();p.l[40]=98;
 const result=evaluateLtfTrigger(p,zone,4);
 assert.equal(result.state,"none");assert.equal(result.touchedAt,null);
});

test("returns null when 1H history is insufficient",()=>{
 const p=fixture();p.n=20;
 for(const key of ["t","ct","o","h","l","c","atr"])p[key]=p[key].slice(0,20);
 assert.equal(evaluateLtfTrigger(p,zone,4),null);
});

test("rejects malformed OHLC data",()=>{
 const p=fixture();p.h[59]=90;
 assert.throws(()=>evaluateLtfTrigger(p,zone,4),TypeError);
});
