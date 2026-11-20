const INTERVAL_MS = { "1h":3600000, "4h":14400000, "1d":86400000, "1w":604800000 };
export function validateOhlcDataset({symbol,interval,bars,expectedStart,expectedEnd}) {
 if(typeof symbol!=="string"||!symbol.trim()) throw new TypeError("symbol is required");
 const step=INTERVAL_MS[interval]; if(!step) throw new RangeError("unsupported interval");
 if(!Array.isArray(bars)||bars.length===0) throw new TypeError("bars must be a non-empty array");
 const issues=[], seen=new Set(); let duplicates=0, malformed=0, gaps=0;
 for(let i=0;i<bars.length;i++){
  const b=bars[i],t=b?.t;
  if(!Number.isSafeInteger(t)||![b?.o,b?.h,b?.l,b?.c].every(Number.isFinite)||![b.o,b.h,b.l,b.c].every(v=>v>0)||b.h<Math.max(b.o,b.c,b.l)||b.l>Math.min(b.o,b.c,b.h)){
   malformed++; issues.push({index:i,type:"MALFORMED_OHLC"}); continue;
  }
  if(seen.has(t)){duplicates++;issues.push({index:i,type:"DUPLICATE_TIMESTAMP"});continue;}
  seen.add(t);
  if(i>0&&Number.isSafeInteger(bars[i-1]?.t)&&t>bars[i-1].t+step){gaps++;issues.push({index:i,type:"MISSING_INTERVALS",missing:Math.floor((t-bars[i-1].t)/step)-1});}
  if(i>0&&Number.isSafeInteger(bars[i-1]?.t)&&t<bars[i-1].t) issues.push({index:i,type:"OUT_OF_ORDER"});
 }
 const first=bars[0]?.t,last=bars[bars.length-1]?.t;
 if(expectedStart!=null&&first>expectedStart) issues.push({type:"START_BOUNDARY_GAP"});
 if(expectedEnd!=null&&last<expectedEnd) issues.push({type:"END_BOUNDARY_GAP"});
 const ordered=bars.every((b,i)=>i===0||b?.t>bars[i-1]?.t);
 const complete=malformed===0&&duplicates===0&&gaps===0&&ordered&&!issues.some(x=>x.type.includes("BOUNDARY"));
 return {status:complete?"COMPLETE":"REVIEW_REQUIRED",symbol,interval,barCount:bars.length,metrics:{malformed,duplicates,gapCount:gaps,ordered},issues,controls:{sourceBarsMutated:false,intervalMs:step},limitations:["Boundary checks compare first/last timestamps only; caller must verify expected range semantics.","This validator does not fetch Binance data or certify candle finality.","Missing intervals are counted between adjacent supplied rows; duplicate and out-of-order rows require upstream normalization."]};
}
export function compareAlignedSymbols(datasets) {
 if(!Array.isArray(datasets)||datasets.length<2) throw new TypeError("at least two datasets are required");
 const base=datasets[0]; if(!base||!Array.isArray(base.bars)) throw new TypeError("each dataset requires bars");
 const baseTimes=base.bars.map(b=>b.t), reports=[];
 for(const ds of datasets.slice(1)){
  if(!Array.isArray(ds?.bars)) throw new TypeError("each dataset requires bars");
  const times=ds.bars.map(b=>b.t), missing=baseTimes.filter(t=>!times.includes(t)), extra=times.filter(t=>!baseTimes.includes(t));
  reports.push({symbol:ds.symbol,aligned:missing.length===0&&extra.length===0,missingCount:missing.length,extraCount:extra.length});
 }
 return {status:reports.every(r=>r.aligned)?"COMPLETE":"REVIEW_REQUIRED",referenceSymbol:base.symbol,referenceCount:baseTimes.length,reports};
}
