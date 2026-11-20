import test from "node:test";
import assert from "node:assert/strict";
import { pivotsAll, prepareIndicators } from "../src/indicators/index.js";
import { structureEvents } from "../src/structure/events.js";
import { buildRegimeTimeline } from "../src/regime/index.js";

function makeOhlc(n) {
 const o=[],h=[],l=[],c=[],v=[];
 for(let i=0;i<n;i++){
  const close=100+0.035*i+4*Math.sin(i/7)+1.2*Math.sin(i/2.9);
  const open=i===0?close: c[i-1]+0.25*Math.sin(i/3.7);
  o.push(open);c.push(close);
  h.push(Math.max(open,close)+0.8+0.15*Math.sin(i));
  l.push(Math.min(open,close)-0.7-0.15*Math.cos(i));
  v.push(1000+120*Math.sin(i/4)+i*0.3);
 }
 return {o,h,l,c,v};
}

test("confirmed structure events are identical on every historical prefix",()=>{
 const data=makeOhlc(180);
 const full=structureEvents({n:data.c.length,c:data.c,h:data.h,l:data.l,piv:pivotsAll(data.h,data.l)},3);
 for(let end=40;end<data.c.length;end++){
  const n=end+1,o=data.o.slice(0,n),h=data.h.slice(0,n),l=data.l.slice(0,n),c=data.c.slice(0,n);
  const prefix=structureEvents({n,c,h,l,piv:pivotsAll(h,l)},3);
  assert.deepEqual(prefix.events,full.events.filter(event=>event.i<=end),`prefix ending at bar ${end}`);
 }
});

test("daily regime decisions do not change when future candles are appended",()=>{
 const data=makeOhlc(320);
 const fullPrepared=prepareIndicators({t:data.c.map((_,i)=>i*86_400_000),o:data.o,h:data.h,l:data.l,c:data.c,v:data.v});
 const full=buildRegimeTimeline(fullPrepared);
 for(const end of [220,235,250,275,300,319]){
  const n=end+1;
  const prefixData={t:fullPrepared.t.slice(0,n),o:data.o.slice(0,n),h:data.h.slice(0,n),l:data.l.slice(0,n),c:data.c.slice(0,n),v:data.v.slice(0,n)};
  const prefix=buildRegimeTimeline(prepareIndicators(prefixData));
  assert.deepEqual(prefix.raw,full.raw.slice(0,n),`raw regime prefix ending at bar ${end}`);
  assert.deepEqual(prefix.eff,full.eff.slice(0,n),`effective regime prefix ending at bar ${end}`);
 }
});
