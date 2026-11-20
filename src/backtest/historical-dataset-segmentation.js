/**
 * Causal historical segmentation for research.
 * Regime labels use trailing closes only (including current bar close).
 * Chronological train/validation/holdout splits are non-overlapping and purged.
 */
const REGIMES = ["BULLISH","BEARISH","SIDEWAYS"];
function validateBars(bars) {
  if (!Array.isArray(bars) || bars.length < 2) throw new TypeError("at least 2 bars are required");
  for (let i=0;i<bars.length;i++) {
    const b=bars[i];
    if (!b || !Number.isFinite(b.t) || !Number.isFinite(b.c) || b.c<=0 || (i && b.t<=bars[i-1].t)) throw new RangeError("invalid or unordered close at index "+i);
  }
}
export function labelCausalRegimes(bars,{lookback=20,trendThresholdPct=3}={}) {
  validateBars(bars);
  if (!Number.isInteger(lookback) || lookback<2 || !Number.isFinite(trendThresholdPct) || trendThresholdPct<=0) throw new RangeError("invalid regime parameters");
  return bars.map((bar,i)=>{
    if(i<lookback) return {t:bar.t,regime:null,ready:false,returnPct:null};
    const start=bars[i-lookback].c;
    const returnPct=(bar.c/start-1)*100;
    const regime=returnPct>=trendThresholdPct?"BULLISH":returnPct<=-trendThresholdPct?"BEARISH":"SIDEWAYS";
    return {t:bar.t,regime,ready:true,returnPct};
  });
}
export function splitChronologicalDataset(bars,{trainPct=0.6,validationPct=0.2,purgeBars=20,embargoBars=1}={}) {
  validateBars(bars);
  if(bars.length < 10) throw new TypeError("at least 10 bars are required for dataset splitting");
  if(!Number.isFinite(trainPct)||!Number.isFinite(validationPct)||trainPct<=0||validationPct<=0||trainPct+validationPct>=1) throw new RangeError("trainPct and validationPct must be positive and sum to less than one");
  if(!Number.isInteger(purgeBars)||purgeBars<0||!Number.isInteger(embargoBars)||embargoBars<0) throw new RangeError("purgeBars and embargoBars must be non-negative integers");
  const n=bars.length,trainEnd=Math.floor(n*trainPct),validationEnd=Math.floor(n*(trainPct+validationPct));
  const validationStart=trainEnd+purgeBars+embargoBars;
  const holdoutStart=validationEnd+purgeBars+embargoBars;
  if(validationStart>=validationEnd||holdoutStart>=n) throw new RangeError("dataset too small for requested splits and purge/embargo");
  const clone=xs=>xs.map(b=>({...b}));
  return {
    status:"COMPLETE",
    splits:{
      training:clone(bars.slice(0,trainEnd)),
      validation:clone(bars.slice(validationStart,validationEnd)),
      holdout:clone(bars.slice(holdoutStart))
    },
    boundaries:{trainEndIndex:trainEnd-1,validationStartIndex:validationStart,validationEndIndex:validationEnd-1,holdoutStartIndex:holdoutStart},
    controls:{chronological:true,nonOverlapping:true,purgeBars,embargoBars,holdoutReturnedSeparately:true},
    warnings:["Regime labels are trailing-return proxies, not a complete market-structure classifier.","Caller must reserve indicator warm-up history without allowing future observations into decisions.","Do not use holdout for parameter selection."]
  };
}
export function buildRegimeBuckets(bars,options={}) {
  const labels=labelCausalRegimes(bars,options);
  const buckets=Object.fromEntries(REGIMES.map(r=>[r,[]]));
  for(let i=0;i<bars.length;i++) {
    const label=labels[i];
    if(label.ready) buckets[label.regime].push({...bars[i],regime:label.regime,regimeReturnPct:label.returnPct});
  }
  return {status:"COMPLETE",method:"causal-trailing-close-return",lookback:options.lookback??20,buckets,counts:Object.fromEntries(REGIMES.map(r=>[r,buckets[r].length]))};
}
