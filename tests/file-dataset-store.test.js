import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileDatasetStore } from "../src/data/file-dataset-store.js";
const start=1700000000000;
const bars=Array.from({length:4},(_,i)=>({t:start+i*3600000,o:100,h:102,l:99,c:101,v:10}));
async function fixture(t){const root=await mkdtemp(join(tmpdir(),"tradesys-store-"));t.after(()=>rm(root,{recursive:true,force:true}));return createFileDatasetStore({rootDir:root});}
test("writes immutable dataset, manifest and verifies checksum on read",async t=>{
 const store=await fixture(t);
 const receipt=await store.writeDataset({id:"BTCUSDT_1h",symbol:"BTCUSDT",interval:"1h",startTime:start,endTime:start+4*3600000,bars});
 assert.equal(receipt.barCount,4);assert.equal(receipt.sha256.length,64);
 const restored=await store.readDataset(receipt);
 assert.deepEqual(restored.bars,bars);
 const manifest=await store.readManifest("BTCUSDT_1h");
 assert.equal(manifest.sha256,receipt.sha256);
});
test("refuses invalid datasets and unsafe identifiers",async t=>{
 const store=await fixture(t);
 await assert.rejects(()=>store.writeDataset({id:"../escape",symbol:"BTCUSDT",interval:"1h",startTime:start,endTime:start+1,bars}),/unsafe/);
 await assert.rejects(()=>store.writeDataset({id:"BTCUSDT_1h",symbol:"BTCUSDT",interval:"1h",startTime:start,endTime:start+4*3600000,bars:[bars[0],bars[2]]}),/quality validation/);
});
test("detects tampering using SHA-256 checksum",async t=>{
 const store=await fixture(t);
 const receipt=await store.writeDataset({id:"ETHUSDT_1h",symbol:"ETHUSDT",interval:"1h",startTime:start,endTime:start+4*3600000,bars});
 const path=join(store.rootDir,receipt.relativePath);
 await writeFile(path,"tampered");
 await assert.rejects(()=>store.readDataset(receipt),/checksum mismatch/);
});
test("rejects receipt path traversal",async t=>{
 const store=await fixture(t);
 await assert.rejects(()=>store.readDataset({relativePath:"../../outside",sha256:"0".repeat(64)}),/escaped/);
});
