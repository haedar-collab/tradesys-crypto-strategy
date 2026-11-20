import test from "node:test";
import assert from "node:assert/strict";
import { runMultiSymbolHistoricalPipeline } from "../src/data/multi-symbol-historical-pipeline.js";
const start=1700000000000;
const bars=Array.from({length:4},(_,i)=>({t:start+i*3600000,o:100,h:102,l:99,c:101,v:10}));
const fetchDataset=async({symbol,interval,startTime,endTime})=>({symbol,interval,startTime,endTime,source:"TEST",bars});
test("runs multi-symbol pipeline, validates before persistence and builds manifest",async()=>{
 const saved=[];
 const result=await runMultiSymbolHistoricalPipeline({symbols:["BTCUSDT","ETHUSDT"],intervals:["1h"],startTime:start,endTime:start+4*3600000,fetchDataset,writeDataset:async x=>{saved.push(x);return {key:x.id};}});
 assert.equal(result.status,"COMPLETE");
 assert.equal(result.summary.expectedDatasets,2);
 assert.equal(saved.length,2);
 assert.equal(result.alignment[0].status,"COMPLETE");
});
test("does not persist a dataset with missing candles",async()=>{
 let saves=0;
 const result=await runMultiSymbolHistoricalPipeline({symbols:["BTCUSDT"],intervals:["1h"],startTime:start,endTime:start+4*3600000,fetchDataset:async args=>({...await fetchDataset(args),bars:[bars[0],bars[2]]}),writeDataset:async()=>{saves++;}});
 assert.equal(result.status,"REVIEW_REQUIRED");assert.equal(saves,0);assert.equal(result.datasets[0].status,"REVIEW_REQUIRED");
});
test("records fetch errors and continues with remaining symbols",async()=>{
 const result=await runMultiSymbolHistoricalPipeline({symbols:["BTCUSDT","ETHUSDT"],intervals:["1h"],startTime:start,endTime:start+4*3600000,fetchDataset:async args=>{if(args.symbol==="BTCUSDT")throw new Error("temporary API error");return fetchDataset(args);}});
 assert.equal(result.status,"REVIEW_REQUIRED");assert.equal(result.datasets[0].status,"FAILED");assert.equal(result.datasets[1].status,"COMPLETE");
});
test("rejects unsupported symbols and invalid ranges",async()=>{
 await assert.rejects(()=>runMultiSymbolHistoricalPipeline({symbols:["DOGEUSDT"],intervals:["1h"],startTime:start,endTime:start+1,fetchDataset}),/approved/);
 await assert.rejects(()=>runMultiSymbolHistoricalPipeline({symbols:["BTCUSDT"],intervals:["5m"],startTime:start,endTime:start+1,fetchDataset}),/unsupported/);
});

import { createFileDatasetStore } from "../src/data/file-dataset-store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("integrates pipeline with persistent checksum-verified file storage",async t=>{
 const root=await mkdtemp(join(tmpdir(),"tradesys-pipeline-"));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const store=createFileDatasetStore({rootDir:root});
 const result=await runMultiSymbolHistoricalPipeline({
  symbols:["BTCUSDT","ETHUSDT"],intervals:["1h"],startTime:start,endTime:start+4*3600000,
  fetchDataset,
  writeDataset:store.writeDataset
 });
 assert.equal(result.status,"COMPLETE");
 for(const dataset of result.datasets){
  const restored=await store.readManifest(dataset.id);
  assert.equal(restored.sha256.length,64);
  assert.equal(restored.barCount,4);
 }
});
