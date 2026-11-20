import {writeFile,mkdir} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {runWalkForwardContractReplay} from "../src/integration/walk-forward-replay.js";

const symbol=(process.env.SYMBOL||"BTCUSDT").toUpperCase(),asOf=Date.now(),H=3600000;
const frames=[["weekly","1w",604800000,250],["daily","1d",86400000,250],["h4","4h",14400000,250],["h1","1h",H,1000]];
const market={};
for(const [key,interval,step,limit] of frames){
 const url=new URL("https://data-api.binance.vision/api/v3/klines");
 url.search=new URLSearchParams({symbol,interval,limit:String(limit),endTime:String(asOf)}).toString();
 const response=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{Accept:"application/json"}});
 if(!response.ok)throw new Error(`Binance ${interval} request failed: HTTP ${response.status}`);
 const rows=await response.json();if(!Array.isArray(rows))throw new Error(`Unexpected ${interval} payload`);
 const candles=rows.map(row=>({openTime:Number(row[0]),open:Number(row[1]),high:Number(row[2]),low:Number(row[3]),close:Number(row[4]),volume:Number(row[5]),closeTime:Number(row[6]),closed:Number(row[6])<asOf})).filter(c=>c.closed);
 if(candles.length<210)throw new Error(`Insufficient closed ${interval} candles: ${candles.length}`);
 for(let i=1;i<candles.length;i++)if(candles[i].openTime-candles[i-1].openTime!==step)throw new Error(`Gap in ${interval} candles at index ${i}`);
 market[key]=candles;
}
const payload={schema_version:"1.0.0",as_of:new Date(asOf).toISOString(),venue:{exchange:"BINANCE",market_type:"SPOT"},universe:[{symbol,quote_asset:"USDT",status:"TRADING"}],market:{[symbol]:market},context:{source:"BINANCE_PUBLIC_KLINES",data_mode:"HISTORICAL_RESEARCH",evaluation_times_ms:[asOf],timeframes:frames.map(x=>x[0]),candle_close_policy:"closeTime < evaluation_time"}};
const result=runWalkForwardContractReplay(payload,{lookbackHours:168,stepHours:1,warmupBars:60});
if(result.status!=="COMPLETE")throw new Error("Walk-forward replay failed: "+JSON.stringify(result));
const report={status:"PASS",symbol,asOf,candleCounts:Object.fromEntries(Object.entries(market).map(([k,v])=>[k,v.length])),walkForward:result.walkForward,decisionCounts:{ready:result.walkForward.readyCount,wait:result.walkForward.waitCount,candidate:result.walkForward.candidateCount},limitations:result.walkForward.limitations};
const output=resolve(process.env.OUTPUT_FILE||"artifacts/binance-btcusdt-walk-forward.json");
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+"\n");
process.stdout.write(JSON.stringify(report,null,2)+"\n");
