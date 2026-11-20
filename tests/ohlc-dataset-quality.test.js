import test from "node:test";
import assert from "node:assert/strict";
import { validateOhlcDataset, compareAlignedSymbols } from "../src/data/ohlc-dataset-quality.js";
const bars=[0,1,2].map(i=>({t:1700000000000+i*3600000,o:100,h:102,l:99,c:101}));
test("accepts ordered valid OHLC candles",()=>{
 const result=validateOhlcDataset({symbol:"BTCUSDT",interval:"1h",bars});
 assert.equal(result.status,"COMPLETE");assert.equal(result.metrics.malformed,0);
});
test("flags malformed, duplicate, out-of-order and missing candles",()=>{
 const bad=[bars[0],{...bars[1],t:bars[0].t},{...bars[2],t:bars[2].t+7200000},{...bars[2],t:bars[2].t-1000}];
 const result=validateOhlcDataset({symbol:"BTCUSDT",interval:"1h",bars:bad});
 assert.equal(result.status,"REVIEW_REQUIRED");
 assert.ok(result.metrics.duplicates>0);assert.ok(result.issues.some(x=>x.type==="OUT_OF_ORDER"));
});
test("compares timestamp alignment across symbols",()=>{
 const result=compareAlignedSymbols([{symbol:"BTCUSDT",bars},{symbol:"ETHUSDT",bars},{symbol:"SOLUSDT",bars:bars.slice(1)}]);
 assert.equal(result.status,"REVIEW_REQUIRED");assert.equal(result.reports[0].aligned,true);assert.equal(result.reports[1].missingCount,1);
});
test("rejects unsupported interval and empty bars",()=>{
 assert.throws(()=>validateOhlcDataset({symbol:"BTCUSDT",interval:"5m",bars}),/unsupported/);
 assert.throws(()=>validateOhlcDataset({symbol:"BTCUSDT",interval:"1h",bars:[]}),/non-empty/);
});
