/**
 * 1H entry trigger after a 4H demand-zone interaction.
 * A touch requires actual OHLC range intersection with the zone.
 * A close through the invalidation buffer permanently breaks the zone
 * within the observation window; a wick below the zone with a close back
 * above is recorded as a reclaim, but is not itself a confirmed entry.
 */
import { structureEvents } from "./events.js";

function pivotsUpTo(pivots, index, confirmationBars) {
  return {
    hi: pivots.hi.filter(value => value <= index - confirmationBars),
    lo: pivots.lo.filter(value => value <= index - confirmationBars)
  };
}

function validateSeries(p1h) {
  if (!p1h || !Number.isInteger(p1h.n) || p1h.n < 60 ||
      !["t","ct","o","h","l","c"].every(key => Array.isArray(p1h[key]) && p1h[key].length === p1h.n) ||
      !p1h.piv || !Array.isArray(p1h.piv.hi) || !Array.isArray(p1h.piv.lo)) return false;
  for (let i=0;i<p1h.n;i++) {
    if (![p1h.t[i],p1h.ct[i],p1h.o[i],p1h.h[i],p1h.l[i],p1h.c[i]].every(Number.isFinite) ||
        p1h.o[i]<=0 || p1h.h[i]<=0 || p1h.l[i]<=0 || p1h.c[i]<=0 ||
        p1h.h[i]<Math.max(p1h.o[i],p1h.c[i],p1h.l[i]) ||
        p1h.l[i]>Math.min(p1h.o[i],p1h.c[i],p1h.h[i]) ||
        (i>0 && p1h.t[i]<=p1h.t[i-1])) return false;
  }
  return true;
}

export function evaluateLtfTrigger(p1h, zone, atr4h) {
  if (!p1h || p1h.n < 60 || !zone) return null;
  if (!validateSeries(p1h)) throw new TypeError("1H series must contain valid, aligned closed OHLC candles and pivots");
  if (!Number.isFinite(atr4h) || atr4h <= 0 || !Number.isFinite(zone.lo) || !Number.isFinite(zone.hi) || zone.lo >= zone.hi) {
    throw new RangeError("valid zone bounds and positive 4H ATR are required");
  }

  const n=p1h.n, i=n-1, close=p1h.c[i], atr1h=p1h.atr?.[i] || atr4h/2;
  const lookback=12, start=Math.max(0,n-lookback), invalidation=zone.lo-0.1*atr4h;
  const invalidatedIndex=p1h.c.findIndex((value,index)=>index>=start&&value<invalidation);
  let touch=-1;
  for(let q=start;q<n;q++) {
    const intersects=p1h.l[q]<=zone.hi && p1h.h[q]>=zone.lo;
    if(intersects){touch=q;break;}
  }
  const reclaimIndex=touch<0?-1:p1h.l.findIndex((value,index)=>
    index>=touch && value<zone.lo && p1h.c[index]>=zone.lo
  );
  const base={
    state:"none",zoneState:"UNTOUCHED",trigger:null,at:null,level:null,close,
    t:p1h.ct[i]+1,stop1h:null,touchedAt:touch>=0?p1h.t[touch]:null,
    invalidatedAt:invalidatedIndex>=0?p1h.t[invalidatedIndex]:null,
    reclaimed:reclaimIndex>=0,reclaimedAt:reclaimIndex>=0?p1h.t[reclaimIndex]:null
  };
  if(invalidatedIndex>=0) return {...base,state:"broken",zoneState:"BROKEN"};
  if(touch<0) return base;

  const lowSince=Math.min(...p1h.l.slice(touch,n));
  const stop1h=Math.min(lowSince-0.25*atr1h,close-Math.max(atr1h,0.5*atr4h));
  const touched={...base,state:"touch",zoneState:reclaimIndex>=0?"RECLAIMED":"TOUCHED",stop1h};

  const bullishEvents=structureEvents(p1h).events.filter(event=>event.dir===1&&event.i>=touch&&event.i>=start);
  if(bullishEvents.length) {
    const event=bullishEvents[bullishEvents.length-1];
    return {...touched,state:"confirmed",trigger:`1H ${event.type}`,at:p1h.t[event.i],level:event.level};
  }

  const pivots=pivotsUpTo(p1h.piv,i,2);
  for(const pivotIndex of pivots.lo.filter(value=>value>=n-60).reverse()) {
    const level=p1h.l[pivotIndex];
    if(level>zone.hi||level<zone.lo-0.5*atr4h) continue;
    for(let q=Math.max(pivotIndex+1,touch);q<n;q++) {
      if(p1h.l[q]<level&&p1h.c[q]>level&&close>level&&close>p1h.o[q]) {
        return {...touched,state:"confirmed",zoneState:"RECLAIMED",trigger:"1H sweep + reclaim",at:p1h.t[q],level};
      }
    }
  }
  return touched;
}
