const BASE_URL = "https://api.binance.com";
const INTERVALS = new Set(["1h","4h","1d","1w"]);
const MAX_LIMIT = 1000;
function assertTimestamp(value,name){if(!Number.isSafeInteger(value)||value<0)throw new TypeError(name+" must be a non-negative integer UTC millisecond timestamp");}
function parseKline(row){
 if(!Array.isArray(row)||row.length<7)throw new TypeError("Binance kline row has invalid shape");
 const [t,o,h,l,c,v,closeTime]=row;
 const parsed={t:Number(t),o:Number(o),h:Number(h),l:Number(l),c:Number(c),v:Number(v),closeTime:Number(closeTime)};
 if(!Number.isSafeInteger(parsed.t)||!Number.isSafeInteger(parsed.closeTime)||![parsed.o,parsed.h,parsed.l,parsed.c,parsed.v].every(Number.isFinite)||![parsed.o,parsed.h,parsed.l,parsed.c].every(x=>x>0)||parsed.v<0||parsed.h<Math.max(parsed.o,parsed.c,parsed.l)||parsed.l>Math.min(parsed.o,parsed.c,parsed.h))throw new TypeError("Binance kline contains invalid OHLCV values");
 return parsed;
}
export async function fetchBinanceSpotKlines({symbol,interval,startTime,endTime,fetchFn=globalThis.fetch,baseUrl=BASE_URL,limit=MAX_LIMIT}){
 if(typeof symbol!=="string"||!/^[A-Z0-9]{5,20}$/.test(symbol))throw new TypeError("symbol must be an uppercase Binance spot symbol");
 if(!INTERVALS.has(interval))throw new RangeError("supported intervals: 1h, 4h, 1d, 1w");
 assertTimestamp(startTime,"startTime");assertTimestamp(endTime,"endTime");
 if(endTime<=startTime)throw new RangeError("endTime must be greater than startTime");
 if(!Number.isInteger(limit)||limit<1||limit>MAX_LIMIT)throw new RangeError("limit must be between 1 and 1000");
 if(typeof fetchFn!=="function")throw new TypeError("fetchFn is required");
 const root=baseUrl.replace(/\/$/,"");
 const get=async path=>{
  const response=await fetchFn(root+path);
  if(!response?.ok)throw new Error("Binance public API request failed: HTTP "+(response?.status??"unknown"));
  return response.json();
 };
 const server=await get("/api/v3/time");
 if(!Number.isSafeInteger(server.serverTime))throw new TypeError("Binance server time response invalid");
 const rows=[],seen=new Set();let cursor=startTime,pages=0;
 while(cursor<endTime){
  const params=new URLSearchParams({symbol,interval,startTime:String(cursor),endTime:String(endTime),limit:String(limit)});
  const batch=await get("/api/v3/klines?"+params.toString());pages++;
  if(!Array.isArray(batch))throw new TypeError("Binance klines response must be an array");
  if(batch.length===0)break;
  let lastOpen=-1;
  for(const raw of batch){
   const bar=parseKline(raw);
   if(bar.t<startTime||bar.t>=endTime)continue;
   if(bar.t<=lastOpen)throw new Error("Binance returned non-increasing candle timestamps");
   lastOpen=bar.t;
   if(bar.closeTime<server.serverTime&&!seen.has(bar.t)){seen.add(bar.t);rows.push(bar);}
  }
  const next=Number(batch[batch.length-1][0])+1;
  if(!Number.isSafeInteger(next)||next<=cursor)throw new Error("Binance pagination did not advance");
  cursor=next;
  if(batch.length<limit)break;
 }
 rows.sort((a,b)=>a.t-b.t);
 return {status:"COMPLETE",source:"BINANCE_SPOT_PUBLIC_REST",symbol,interval,serverTime:server.serverTime,startTime,endTime,pageCount:pages,barCount:rows.length,bars:rows,controls:{closedCandlesOnly:true,duplicateTimestampsRemoved:true,chronological:true,apiKeyRequired:false},limitations:["Public REST endpoint; request weight and rate limits still apply.","An empty or short response does not prove the requested date range is complete; validate expected coverage and gaps separately.","No automatic retry is performed; caller should apply bounded backoff for HTTP 429/418/5xx."]};
}
