/**
 * Deterministic demand-zone selection for long-only SMC.
 * Keeps zone discovery separate from policy so callers can inspect candidates.
 */
import { zoneQuality } from "./quality.js";

export function selectDemandZone({ price, atr, rangeEquilibrium, orderBlocks = [], fvgs = [], series, maxAtrDistance = 4 }) {
  if (![price, atr, rangeEquilibrium, maxAtrDistance].every(Number.isFinite) ||
      price <= 0 || atr <= 0 || maxAtrDistance <= 0) throw new RangeError("invalid zone selection context");
  if (!series) throw new TypeError("prepared 4H series is required for quality scoring");
  const candidates = [];
  for (const ob of orderBlocks) {
    if (!ob || ![ob.lo, ob.hi].every(Number.isFinite) || ob.lo >= ob.hi || !Number.isInteger(ob.idx)) continue;
    if (ob.lo >= price * 1.002 || ob.hi <= price - maxAtrDistance * atr) continue;
    const overlap = fvgs.find(f => f && Number.isFinite(f.lo) && Number.isFinite(f.hi) && f.lo < ob.hi && f.hi > ob.lo);
    candidates.push({
      ...ob, kind: overlap ? "Order block + FVG" : "Order block",
      overlap: !!overlap,
      quality: zoneQuality(series, ob, atr, "demand", ob.from)
    });
  }
  candidates.sort((a,b) => {
    const aDiscount = a.hi <= rangeEquilibrium * 1.01 ? 1 : 0;
    const bDiscount = b.hi <= rangeEquilibrium * 1.01 ? 1 : 0;
    return bDiscount-aDiscount || Number(b.overlap)-Number(a.overlap) ||
      b.hi-a.hi || b.idx-a.idx;
  });
  if (candidates.length) return { selected: candidates[0], candidates };
  const fvg = fvgs.filter(f => f && Number.isFinite(f.lo) && Number.isFinite(f.hi) &&
    Number.isInteger(f.idx) && f.lo < f.hi && f.hi <= price && f.hi > price-maxAtrDistance*atr)
    .sort((a,b)=>b.hi-a.hi)[0];
  if (!fvg) return { selected: null, candidates };
  const selected = { ...fvg, kind:"FVG", overlap:false,
    quality: zoneQuality(series,fvg,atr,"demand",fvg.idx+1) };
  return { selected, candidates };
}
