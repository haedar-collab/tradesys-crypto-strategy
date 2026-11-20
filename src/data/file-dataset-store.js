import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve, sep } from "node:path";
import { validateOhlcDataset } from "./ohlc-dataset-quality.js";

function safeSegment(value,name){
 if(typeof value!=="string"||!/^[A-Z0-9_-]{1,32}$/.test(value)) throw new TypeError(name+" contains unsafe characters");
 return value;
}
function digest(value){return createHash("sha256").update(value).digest("hex");}
function inside(root,path){return path===root||path.startsWith(root+sep);}
async function atomicWrite(path,content){
 await mkdir(resolve(path,".."),{recursive:true});
 const temp=path+".tmp-"+randomUUID();
 try { await writeFile(temp,content,{flag:"wx"}); await rename(temp,path); }
 catch(error){try{const {unlink}=await import("node:fs/promises");await unlink(temp);}catch{} throw error;}
}
export function createFileDatasetStore({rootDir}){
 if(typeof rootDir!=="string"||!rootDir.trim()) throw new TypeError("rootDir is required");
 const root=resolve(rootDir);
 function datasetPath({symbol,interval,startTime,endTime,sha256}){
  safeSegment(symbol,"symbol");safeSegment(interval,"interval");
  if(!Number.isSafeInteger(startTime)||!Number.isSafeInteger(endTime)||startTime<0||endTime<=startTime) throw new RangeError("invalid dataset range");
  if(!/^[a-f0-9]{64}$/.test(sha256)) throw new TypeError("invalid sha256");
  const path=resolve(root,symbol,interval,String(startTime)+"_"+String(endTime)+"_"+sha256+".json");
  if(!inside(root,path)) throw new Error("dataset path escaped storage root");
  return path;
 }
 return {
  async writeDataset({id,symbol,interval,startTime,endTime,bars,metadata={}}){
   safeSegment(id,"id");
   const quality=validateOhlcDataset({symbol,interval,bars});
   if(quality.status!=="COMPLETE") throw new Error("refusing to persist dataset that failed quality validation");
   const payload={schemaVersion:1,id,symbol,interval,startTime,endTime,createdAt:new Date().toISOString(),metadata,bars};
   const content=JSON.stringify(payload)+"\n",sha256=digest(content);
   const path=datasetPath({symbol,interval,startTime,endTime,sha256});
   await mkdir(resolve(path,".."),{recursive:true});
   try { await writeFile(path,content,{flag:"wx"}); }
   catch(error){
    if(error.code!=="EEXIST") throw error;
    const existing=await readFile(path,"utf8");
    if(digest(existing)!==sha256) throw new Error("immutable dataset path collision");
   }
   const receipt={id,symbol,interval,startTime,endTime,sha256,relativePath:path.slice(root.length+1),barCount:bars.length,storedAt:payload.createdAt};
   const indexPath=join(root,"manifest",id+".json");
   const indexContent=JSON.stringify({schemaVersion:1,...receipt,metadata})+"\n";
   await atomicWrite(indexPath,indexContent);
   return receipt;
  },
  async readDataset(receipt){
   if(!receipt||typeof receipt!=="object") throw new TypeError("receipt is required");
   const path=resolve(root,receipt.relativePath??"");
   if(!inside(root,path)) throw new Error("receipt path escaped storage root");
   const content=await readFile(path,"utf8");
   const actual=digest(content);
   if(actual!==receipt.sha256) throw new Error("dataset checksum mismatch");
   const dataset=JSON.parse(content);
   if(dataset.symbol!==receipt.symbol||dataset.interval!==receipt.interval) throw new Error("dataset identity mismatch");
   return dataset;
  },
  async readManifest(id){
   safeSegment(id,"id");
   return JSON.parse(await readFile(join(root,"manifest",id+".json"),"utf8"));
  },
  rootDir:root
 };
}
