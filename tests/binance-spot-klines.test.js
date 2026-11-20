import test from "node:test";
import assert from "node:assert/strict";
import { fetchBinanceSpotKlines } from "../src/data/binance-spot-klines.js";
const k=(t,closeTime=t+3599999,c="100")=>[t,"99","102","98",c,"12",closeTime,"0","0","0","0","0"];
function mockFetch(responses){const calls=[];return {calls,fetchFn:async url=>{calls.push(url);const item=responses.shift();if(!item)throw new Error("unexpected request");return {ok:true,json:async()=>item};}};}
test("paginates public spot klines and keeps only closed candles",async()=>{
 const start=1700000000000, end=start+7200000;
 const mock=mockFetch([{serverTime:start+7200000},[k(start),k(start+3600000),k(start+7200000)]]);
 const result=await fetchBinanceSpotKlines({symbol:"BTCUSDT",interval:"1h",startTime:start,endTime:end,fetchFn:mock.fetchFn,limit:2});
 assert.equal(result.barCount,2);assert.equal(result.controls.closedCandlesOnly,true);assert.equal(result.bars[0].t,start);
 assert.equal(mock.calls.length,2);
});
test("rejects invalid symbol, interval and date range",async()=>{
 const noop=async()=>({ok:true,json:async()=>({serverTime:1})});
 await assert.rejects(()=>fetchBinanceSpotKlines({symbol:"btc/usdt",interval:"1h",startTime:1,endTime:2,fetchFn:noop}),/symbol/);
 await assert.rejects(()=>fetchBinanceSpotKlines({symbol:"BTCUSDT",interval:"5m",startTime:1,endTime:2,fetchFn:noop}),/supported intervals/);
 await assert.rejects(()=>fetchBinanceSpotKlines({symbol:"BTCUSDT",interval:"1h",startTime:2,endTime:2,fetchFn:noop}),/greater than/);
});
test("rejects malformed OHLC response",async()=>{
 const mock=mockFetch([{serverTime:9999999999999},[[1,"100","90","95","99","1",2]]]);
 await assert.rejects(()=>fetchBinanceSpotKlines({symbol:"BTCUSDT",interval:"1h",startTime:1,endTime:100,fetchFn:mock.fetchFn}),/invalid OHLCV/);
});
