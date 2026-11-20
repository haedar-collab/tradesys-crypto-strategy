import { fetchBinanceSpotKlines } from "./binance-spot-klines.js";
import { validateOhlcDataset, compareAlignedSymbols } from "./ohlc-dataset-quality.js";

export const DEFAULT_SYMBOLS = Object.freeze(["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT"]);
export const DEFAULT_INTERVALS = Object.freeze(["1h","4h","1d","1w"]);

function validateRequest({symbols,intervals,startTime,endTime}) {
 if(!Array.isArray(symbols)||symbols.length===0||new Set(symbols).size!==symbols.length) throw new TypeError("symbols must be a non-empty unique array");
 if(symbols.some(s=>!DEFAULT_SYMBOLS.includes(s))) throw new RangeError("symbol is outside the approved initial research universe");
 if(!Array.isArray(intervals)||intervals.length===0||new Set(intervals).size!==intervals.length) throw new TypeError("intervals must be a non-empty unique array");
 if(intervals.some(i=>!DEFAULT_INTERVALS.includes(i))) throw new RangeError("unsupported research interval");
 if(!Number.isSafeInteger(startTime)||!Number.isSafeInteger(endTime)||startTime<0||endTime<=startTime) throw new RangeError("invalid UTC millisecond date range");
}
export async function runMultiSymbolHistoricalPipeline({
 symbols=DEFAULT_SYMBOLS,intervals=DEFAULT_INTERVALS,startTime,endTime,
 fetchDataset=fetchBinanceSpotKlines,writeDataset=async()=>null,
 fetchOptions={},onProgress=()=>{}
}) {
 validateRequest({symbols,intervals,startTime,endTime});
 if(typeof fetchDataset!=="function"||typeof writeDataset!=="function"||typeof onProgress!=="function") throw new TypeError("fetchDataset, writeDataset and onProgress must be functions");
 const manifest={schemaVersion:1,source:"BINANCE_SPOT_PUBLIC_REST",createdAt:new Date().toISOString(),range:{startTime,endTime},requested:{symbols:[...symbols],intervals:[...intervals]},datasets:[],alignment:[],status:"RUNNING"};
 const byInterval=new Map(intervals.map(i=>[i,[]]));
 for(const symbol of symbols) for(const interval of intervals) {
  const id=symbol+"_"+interval;
  try {
   const fetched=await fetchDataset({symbol,interval,startTime,endTime,...fetchOptions});
   if(!fetched||!Array.isArray(fetched.bars)||fetched.symbol!==symbol||fetched.interval!==interval) throw new Error("fetcher returned mismatched or invalid dataset");
   const quality=validateOhlcDataset({symbol,interval,bars:fetched.bars});
   const record={id,symbol,interval,status:quality.status,source:fetched.source??"INJECTED_FETCHER",serverTime:fetched.serverTime??null,startTime,endTime,pageCount:fetched.pageCount??null,barCount:fetched.bars.length,quality};
   if(quality.status==="COMPLETE") {
    const storage=await writeDataset({id,symbol,interval,startTime,endTime,bars:fetched.bars,metadata:record});
    record.storage=storage??null;
    byInterval.get(interval).push({symbol,bars:fetched.bars});
   } else record.error="Dataset failed quality validation; not persisted.";
   manifest.datasets.push(record);
   onProgress({completed:manifest.datasets.length,total:symbols.length*intervals.length,id,status:record.status});
  } catch(error) {
   const record={id,symbol,interval,status:"FAILED",startTime,endTime,error:error instanceof Error?error.message:String(error)};
   manifest.datasets.push(record);
   onProgress({completed:manifest.datasets.length,total:symbols.length*intervals.length,id,status:"FAILED"});
  }
 }
 for(const [interval,datasets] of byInterval) {
  if(datasets.length>=2) manifest.alignment.push({interval,...compareAlignedSymbols(datasets)});
  else manifest.alignment.push({interval,status:"NOT_ENOUGH_VALID_DATASETS",validDatasetCount:datasets.length});
 }
 const expected=symbols.length*intervals.length;
 const passed=manifest.datasets.filter(d=>d.status==="COMPLETE").length;
 const failed=expected-passed;
 const alignmentFailed=manifest.alignment.some(a=>a.status!=="COMPLETE");
 manifest.status=failed===0&&!alignmentFailed?"COMPLETE":"REVIEW_REQUIRED";
 manifest.summary={expectedDatasets:expected,validatedDatasets:passed,failedDatasets:failed,alignmentStatus:alignmentFailed?"REVIEW_REQUIRED":"COMPLETE",persistedOnlyAfterValidation:true};
 return manifest;
}
