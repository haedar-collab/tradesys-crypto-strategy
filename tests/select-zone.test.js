import test from "node:test";
import assert from "node:assert/strict";
import { selectDemandZone } from "../src/structure/select-zone.js";

function series(){
 const n=30, o=Array(n).fill(100), c=Array(n).fill(100), h=Array(n).fill(101), l=Array(n).fill(99);
 for(let i=0;i<n;i++){o[i]=100+i*.1;c[i]=100+i*.1;h[i]=o[i]+1;l[i]=o[i]-1;}
 return {n,o,c,h,l,atr:Array(n).fill(1)};
}
const ob=(lo,hi,idx,from=idx+1)=>({lo,hi,idx,from,t:idx});

test("prefers discount zone with OB/FVG overlap over a nearer premium zone",()=>{
 const p=series();
 const low=ob(95,97,10), high=ob(99,100,20);
 const result=selectDemandZone({price:100.9,atr:1,rangeEquilibrium:98,fvgs:[{lo:96,hi:96.5,idx:12}],orderBlocks:[high,low],series:p});
 assert.equal(result.selected.idx,10);
 assert.equal(result.selected.kind,"Order block + FVG");
 assert.equal(result.candidates.length,2);
});

test("falls back to nearest valid unfilled FVG when no OB is eligible",()=>{
 const p=series();
 const result=selectDemandZone({price:100,atr:1,rangeEquilibrium:98,fvgs:[{lo:96,hi:97,idx:10},{lo:98,hi:99,idx:15}],series:p});
 assert.equal(result.selected.kind,"FVG");
 assert.equal(result.selected.idx,15);
});

test("returns no selected zone if all candidates are outside the configured distance",()=>{
 const result=selectDemandZone({price:100,atr:1,rangeEquilibrium:98,orderBlocks:[ob(90,91,10)],fvgs:[{lo:90,hi:91,idx:10}],series:series(),maxAtrDistance:4});
 assert.equal(result.selected,null);
});

test("rejects invalid price context",()=>{
 assert.throws(()=>selectDemandZone({price:0,atr:1,rangeEquilibrium:10,series:series()}),RangeError);
});
