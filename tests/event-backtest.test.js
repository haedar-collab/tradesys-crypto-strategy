import test from "node:test";
import assert from "node:assert/strict";
import { runEventBacktest } from "../src/backtest/event-driven.js";

const plan={entry:100,stop:95,tp1:105,tp2:110,tp3:115};
function bars(rows) {
 return rows.map((r,i)=>({t:i*60_000,o:r[0],h:r[1],l:r[2],c:r[3]}));
}
function signal(index=0,overrides={}) { return {index,plan:{...plan,...overrides}}; }

test("enters on the bar after the signal close and processes that entry bar",()=>{
 const result=runEventBacktest({
  bars:bars([[100,120,99,110],[100,106,99,104],[100,104,99,102]]),
  signals:[signal()],feeBps:0,slippageBps:0
 });
 assert.equal(result.tradeCount,1);
 assert.equal(result.trades[0].entryIndex,1);
 assert.equal(result.trades[0].exitIndex,1);
 assert.deepEqual(result.trades[0].exitEvents.map(x=>x.reason),["TP1","BREAKEVEN_SAME_BAR"]);
});

test("charges entry and per-tranche exit fees plus adverse slippage",()=>{
 const result=runEventBacktest({
  bars:bars([[100,101,99,100],[100,104,99.9,103],[100,104,94,96]]),
  signals:[signal()],feeBps:10,slippageBps:5
 });
 assert.equal(result.tradeCount,1);
 assert.ok(result.trades[0].fees>0);
 assert.ok(result.trades[0].grossPnl<0);
 assert.ok(result.trades[0].netPnl<result.trades[0].grossPnl);
});

test("skips a next-bar entry when price gaps beyond the allowed drift",()=>{
 const result=runEventBacktest({
  bars:bars([[100,101,99,100],[102,103,101,102],[102,103,101,102]]),
  signals:[signal()],maxEntryDriftPct:1
 });
 assert.equal(result.tradeCount,0);
 assert.equal(result.skipped[0].reason,"ENTRY_GAP_EXCEEDS_MAX_DRIFT");
});

test("keeps a position open at the end and reports mark-to-market separately",()=>{
 const result=runEventBacktest({
  bars:bars([[100,101,99,100],[100,104,99,103],[103,104,101,102]]),
  signals:[signal()],feeBps:0,slippageBps:0
 });
 assert.equal(result.tradeCount,0);
 assert.equal(result.openPosition.status,"OPEN");
 assert.equal(result.openPosition.markPrice,102);
 assert.equal(result.endingEquity,result.initialCapital);
});

test("rejects unordered bars and invalid signal plans",()=>{
 assert.throws(()=>runEventBacktest({bars:[{t:1,o:1,h:2,l:.5,c:1},{t:1,o:1,h:2,l:.5,c:1}],signals:[]}),RangeError);
 assert.throws(()=>runEventBacktest({bars:bars([[100,101,99,100],[100,101,99,100]]),signals:[{index:0,plan:{entry:100,stop:101,tp1:105,tp2:110,tp3:115}}]}),TypeError);
});
