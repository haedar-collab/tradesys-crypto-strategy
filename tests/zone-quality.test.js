import test from "node:test";
import assert from "node:assert/strict";
import { zoneVisits, zoneOrigin, zoneQuality } from "../src/structure/quality.js";

function makeSeries() {
  const o=[10,10,9,10,10,10,10,10,10,10,10,10];
  const c=[9.5,9,10,11,12,11,10,11,12,11,10,11];
  const h=[10,10,10,12,13,12,11,12,13,12,11,12];
  const l=[9,8,8.5,9.5,10.5,9.5,9,9.5,10.5,9.5,9,9.5];
  return {n:o.length,o,c,h,l,atr:Array(o.length).fill(1)};
}

test("counts separate prior zone visits and excludes the current ongoing visit",()=>{
 const p=makeSeries();
 const v=zoneVisits(p,8,9.5,2,"demand");
 assert.deepEqual(v,{prior:2,ongoing:true});
});

test("classifies demand origin pattern and departure strength",()=>{
 const p=makeSeries();
 const origin=zoneOrigin(p,2,1,"demand",3,8,10);
 assert.equal(origin.pattern,"DBR");
 assert.equal(origin.baseN,1);
 assert.ok(origin.departAtr>0);
});

test("scores fresh strong demand zones and reports human-readable quality",()=>{
 const p=makeSeries();
 const q=zoneQuality(p,{lo:8,hi:9.5,idx:2},1,"demand",3);
 assert.equal(q.prior,2);
 assert.equal(q.fresh,false);
 assert.equal(q.quality,"Weak");
 assert.match(q.text,/tested 2×/);
});

test("allows a zone with no candles after its origin",()=>{
 const p=makeSeries();
 const q=zoneQuality(p,{lo:8,hi:9.5,idx:p.n-1},1,"demand",p.n);
 assert.equal(q.prior,0);
 assert.equal(q.inNow,false);
});

test("rejects invalid zones and side values",()=>{
 const p=makeSeries();
 assert.throws(()=>zoneVisits(p,10,9,1,"demand"),RangeError);
 assert.throws(()=>zoneQuality(p,{lo:8,hi:9,idx:1},1,"buy",2),RangeError);
});
