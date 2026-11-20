import test from "node:test";
import assert from "node:assert/strict";
import { labelCausalRegimes, splitChronologicalDataset, buildRegimeBuckets } from "../src/backtest/historical-dataset-segmentation.js";
const bars=Array.from({length:300},(_,i)=>({t:i+1,c:100+i*0.2}));
test("labels regimes using trailing data only",()=>{
 const input=[{t:1,c:100},{t:2,c:100},{t:3,c:100},{t:4,c:104},{t:5,c:108}];
 const labels=labelCausalRegimes(input,{lookback:2,trendThresholdPct:3});
 assert.equal(labels[0].ready,false);
 assert.equal(labels[4].regime,"BULLISH");
});
test("creates chronological purged non-overlapping splits",()=>{
 const result=splitChronologicalDataset(bars,{trainPct:.6,validationPct:.2,purgeBars:10,embargoBars:2});
 assert.equal(result.status,"COMPLETE");
 assert.ok(result.splits.training.at(-1).t < result.splits.validation[0].t);
 assert.ok(result.splits.validation.at(-1).t < result.splits.holdout[0].t);
 assert.equal(result.controls.holdoutReturnedSeparately,true);
});
test("rejects invalid split ratios and undersized data",()=>{
 assert.throws(()=>splitChronologicalDataset(bars,{trainPct:.8,validationPct:.3}),/sum to less/);
 assert.throws(()=>splitChronologicalDataset(bars,{trainPct:.6,validationPct:.2,purgeBars:200}),/too small/);
});
test("builds three regime buckets and accounts for all ready labels",()=>{
 const result=buildRegimeBuckets(bars,{lookback:10,trendThresholdPct:1.5});
 assert.equal(result.status,"COMPLETE");
 assert.equal(result.counts.BULLISH,290);
 assert.equal(result.counts.BEARISH,0);
 assert.equal(result.counts.SIDEWAYS,0);
});
