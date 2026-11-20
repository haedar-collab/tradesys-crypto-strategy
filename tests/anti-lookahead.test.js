import test from "node:test";
import assert from "node:assert/strict";
import { pivotsAll, prepareIndicators } from "../src/indicators/index.js";
import { structureEvents } from "../src/structure/events.js";
import { buildRegimeTimeline } from "../src/regime/index.js";

function makeOhlc(n) {
 const o=[],h=[],l=[],c=[],v=[];
 for(let i=0;i<n;i++){
  const close=100+0.035*i+4*Math.sin(i/7)+1.2*Math.sin(i/2.9);
  const open=i===0?close:c[i-1]+0.25*Math.sin(i/3.7);
  o.push(open);c.push(close);
  h.push(Math.max(open,close)+0.8+0.15*Math.sin(i));
  l.push(Math.min(open,close)-0.7-0.15*Math.cos(i));
  v.push(1000+120*Math.sin(i/4)+i*0.3);
 }
 return {o,h,l,c,v};
}
function sliceData(data,end){
 const n=end+1;
 return {t:Array.from({length:n},(_,i)=>i*86_400_000),o:data.o.slice(0,n),h:data.h.slice(0,n),l:data.l.slice(0,n),c:data.c.slice(0,n),v:data.v.slice(0,n)};
}
function comparableIndicatorSnapshot(p,i){
 return {e20:p.e20[i],e50:p.e50[i],e200:p.e200[i],rsi:p.rsi[i],atr:p.atr[i],adx:p.adx[i],
  bb:p.bb[i],bbw:p.bbw[i],atrp:p.atrp[i],obv:p.obv[i],vsma:p.vsma[i]};
}

test("confirmed structure events are identical on every historical prefix",()=>{
 const data=makeOhlc(180);
 const full=structureEvents({n:data.c.length,c:data.c,h:data.h,l:data.l,piv:pivotsAll(data.h,data.l)},3);
 for(let end=40;end<data.c.length;end++){
  const n=end+1,h=data.h.slice(0,n),l=data.l.slice(0,n),c=data.c.slice(0,n);
  const prefix=structureEvents({n,c,h,l,piv:pivotsAll(h,l)},3);
  assert.deepEqual(prefix.events,full.events.filter(event=>event.i<=end),`prefix ending at bar ${end}`);
 }
});

test("daily regime decisions do not change when future candles are appended",()=>{
 const data=makeOhlc(320);
 const fullPrepared=prepareIndicators(sliceData(data,319));
 const full=buildRegimeTimeline(fullPrepared);
 for(const end of [220,235,250,275,300,319]){
  const prefix=buildRegimeTimeline(prepareIndicators(sliceData(data,end)));
  assert.deepEqual(prefix.raw,full.raw.slice(0,end+1),`raw regime prefix ending at bar ${end}`);
  assert.deepEqual(prefix.eff,full.eff.slice(0,end+1),`effective regime prefix ending at bar ${end}`);
 }
});

test("all causal indicator values at timestamp T are invariant to future-bar perturbations",()=>{
 const data=makeOhlc(360),end=270;
 const full=prepareIndicators(sliceData(data,359));
 const perturbed={o:[...data.o],h:[...data.h],l:[...data.l],c:[...data.c],v:[...data.v]};
 for(let i=end+1;i<perturbed.c.length;i++){
  perturbed.o[i]*=1.7;perturbed.h[i]*=2.1;perturbed.l[i]*=.55;perturbed.c[i]*=1.9;perturbed.v[i]*=4;
 }
 const changedFuture=prepareIndicators(sliceData(perturbed,359));
 const prefix=prepareIndicators(sliceData(data,end));
 assert.deepEqual(comparableIndicatorSnapshot(full,end),comparableIndicatorSnapshot(prefix,end));
 assert.deepEqual(comparableIndicatorSnapshot(changedFuture,end),comparableIndicatorSnapshot(prefix,end));
});

test("a pivot is not emitted as a structure break before its right-side confirmation bars",()=>{
 const high=[1,2,5,3,2,2,2],low=[0,1,2,1,0,1,1],close=[1,2,4,3,2,2,6];
 const fullPiv=pivotsAll(high,low,2);
 const atFour=structureEvents({n:5,c:close.slice(0,5),h:high.slice(0,5),l:low.slice(0,5),piv:pivotsAll(high.slice(0,5),low.slice(0,5),2)},2);
 const full=structureEvents({n:7,c:close,h:high,l:low,piv:fullPiv},2);
 assert.deepEqual(atFour.events,full.events.filter(event=>event.i<=4));
});
