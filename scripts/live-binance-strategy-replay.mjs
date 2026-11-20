import {writeFile,mkdir} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {runStrategyContractReplay} from "../src/integration/app-data-contract-v1.js";

const symbol=(process.env.SYMBOL||"BTCUSDT").toUpperCase();
const asOf=Date.now();
const frames=[["weekly","1w",604800000],["daily","1d",86400000],["h4","4h",14400000],["h1","1h",3600000]];
const market={};
for(const [key,interval,step] of frames){
 const url=new URL("https://data-api.binance.vision/api/v3/klines");
 url.search=new URLSearchParams({symbol,interval,limit:"250",endTime:String(asOf)}).toString();
 const response=await fetch(url,{signal:AbortSignal.timeout(15000),headers:{Accept:"application/json"}});
 if(!response.ok)throw new Error(`Binance ${interval} request failed: HTTP ${response.status}`);
 const rows=await response.json();
 if(!Array.isArray(rows))throw new Error(`Unexpected ${interval} payload`);
 const candles=rows.map(row=>({openTime:Number(row[0]),open:Number(row[1]),high:Number(row[2]),low:Number(row[3]),close:Number(row[4]),volume:Number(row[5]),closeTime:Number(row[6]),closed:Number(row[6])<asOf}))
  .filter(c=>c.closed);
 if(candles.length<210)throw new Error(`Insufficient closed ${interval} candles: ${candles.length}`);
 for(let i=1;i<candles.length;i++){
  if(candles[i].openTime-candles[i-1].openTime!==step)throw new Error(`Gap in ${interval} candles at index ${i}`);
 }
 market[key]=candles;
}
const payload={schema_version:"1.0.0",as_of:new Date(asOf).toISOString(),venue:{exchange:"BINANCE",market_type:"SPOT"},universe:[{symbol,quote_asset:"USDT",status:"TRADING"}],market:{[symbol]:market},context:{source:"BINANCE_PUBLIC_KLINES",data_mode:"HISTORICAL_RESEARCH",evaluation_times_ms:[asOf],timeframes:frames.map(x=>x[0]),candle_close_policy:"closeTime < evaluation_time"}};
const result=runStrategyContractReplay(payload);
if(result.status!=="COMPLETE")throw new Error("Strategy replay did not complete: "+JSON.stringify(result));
const summary={status:"PASS",symbol,asOf,counts:Object.fromEntries(Object.entries(market).map(([k,v])=>[k,v.length])),replay:{status:result.status,mode:result.mode,evaluationCount:result.replay.evaluationCount,readyCount:result.replay.readyCount,candidateCount:result.replay.candidateCount,decision:result.replay.decisions[0]},limitations:["Single evaluation timestamp; not a historical walk-forward performance test","No transaction fees, slippage, order fills or portfolio simulation","No trading orders are sent"]};
const output=resolve(process.env.OUTPUT_FILE||"artifacts/binance-btcusdt-live-replay.json");
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(summary,null,2)+"\n");
process.stdout.write(JSON.stringify(summary,null,2)+"\n");
