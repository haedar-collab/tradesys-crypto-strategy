import test from "node:test";
import assert from "node:assert/strict";
import { classifyMarketRegimes, summarizeTradesByEntryRegime } from "../src/backtest/market-regime-analysis.js";
import { runTradeBlockBootstrap } from "../src/backtest/block-bootstrap.js";
const observations=(closes,start=1_700_000_000_000,step=86_400_000)=>closes.map((close,i)=>({timestamp:start+i*step,close}));

test("regime classifier uses trailing data and emits bullish labels",()=>{
 const rows=observations(Array.from({length:30},(_,i)=>100+i*2)),result=classifyMarketRegimes(rows,{lookbackBars:5,bullishThresholdPct:3});
 assert.equal(result.status,"COMPLETE");assert.equal(result.labels[0].timestamp,rows[5].timestamp);assert.ok(result.labels.every(x=>x.direction==="BULLISH"));
});
test("regime classifier identifies bearish and sideways windows",()=>{
 const down=classifyMarketRegimes(observations(Array.from({length:15},(_,i)=>150-i*3)),{lookbackBars:5}),flat=classifyMarketRegimes(observations(Array(15).fill(100)),{lookbackBars:5});
 assert.ok(down.labels.every(x=>x.direction==="BEARISH"));assert.ok(flat.labels.every(x=>x.direction==="SIDEWAYS"));
});
test("regime attribution uses latest label at or before entry and retains earlier unclassified trades",()=>{
 const labels=[{timestamp:100,direction:"BULLISH",volatility:"NORMAL"}];
 const result=summarizeTradesByEntryRegime([{entryTime:50,netReturnPct:-1},{entryTime:100,netReturnPct:2},{entryTime:200,netReturnPct:-1}],labels);
 assert.equal(result.groups.length,2);
 assert.equal(result.groups.find(x=>x.regime==="UNCLASSIFIED").tradeCount,1);
 assert.equal(result.groups.find(x=>x.regime==="BULLISH_NORMAL").tradeCount,2);
});
test("regime classifier rejects invalid timestamps and settings",()=>{
 assert.throws(()=>classifyMarketRegimes([{timestamp:1,close:10},{timestamp:1,close:11},{timestamp:2,close:12}]),/ascending/);
 assert.throws(()=>classifyMarketRegimes(observations([1,2,3]),{lookbackBars:1}),/lookbackBars/);
});
test("block bootstrap is deterministic and reports risk percentiles",()=>{
 const args={tradeReturns:[.03,-.02,.01,-.01,.04,-.03],blockLength:2,simulations:300,tradesPerSimulation:30,seed:12},a=runTradeBlockBootstrap(args),b=runTradeBlockBootstrap(args);
 assert.deepEqual(a,b);assert.equal(a.method,"NON_CIRCULAR_MOVING_BLOCK_BOOTSTRAP");assert.ok(a.maxDrawdownPct.p99>=a.maxDrawdownPct.p95);
});
test("block bootstrap validates sample and configuration",()=>{
 assert.throws(()=>runTradeBlockBootstrap({tradeReturns:[.1]}),/at least two/);
 assert.throws(()=>runTradeBlockBootstrap({tradeReturns:[.1,.2],blockLength:3}),/blockLength/);
 assert.throws(()=>runTradeBlockBootstrap({tradeReturns:[.1,.2],blockLength:1,simulations:20}),/simulations/);
});
