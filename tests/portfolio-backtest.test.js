import test from "node:test";
import assert from "node:assert/strict";
import { runPortfolioBacktest } from "../src/backtest/portfolio.js";
import { runEventBacktest } from "../src/backtest/event-driven.js";

const plan={entry:100,stop:95,tp1:105,tp2:110,tp3:115};
function bars(rows){return rows.map((r,i)=>({t:i*60_000,o:r[0],h:r[1],l:r[2],c:r[3]}));}
function asset(rows,signals,dailyReturns){return {bars:bars(rows),signals,dailyReturns};}
function signal(index=0,priority=0){return {index,priority,plan:{...plan}};}
const commonRows=[[100,101,99,100],[100,104,99,102],[102,111,101,110],[110,116,101,114]];

test("enforces max concurrent positions and regime exposure across symbols",()=>{
 const result=runPortfolioBacktest({
  assets:{
   AAAUSDT:asset(commonRows,[signal(0,2)],[.01,.02,.03,.04]),
   BBBUSDT:asset(commonRows,[signal(0,1)],[.02,.01,.04,.03])
  },
  maxPositions:1,regimeCapPct:80,feeBps:0,slippageBps:0
 });
 assert.equal(result.tradeCount,1);
 assert.equal(result.trades[0].symbol,"AAAUSDT");
 assert.ok(result.skipped.some(x=>x.symbol==="BBBUSDT"&&x.reason.includes("MAX_POSITIONS_REACHED")));
});

test("blocks a candidate correlated with an existing open asset",()=>{
 const result=runPortfolioBacktest({
  assets:{
   AAAUSDT:asset(commonRows,[signal()],[1,2,3,4,5]),
   BBBUSDT:asset(commonRows,[signal()],[2,4,6,8,10])
  },
  maxPositions:5,regimeCapPct:100,feeBps:0,slippageBps:0,corrMax:.8
 });
 assert.ok(result.skipped.some(x=>x.symbol==="BBBUSDT"&&x.reason.includes("CORRELATED_WITH_ACTIVE_POSITION")));
});

test("fails closed when correlation history is missing while another position is open",()=>{
 const result=runPortfolioBacktest({
  assets:{
   AAAUSDT:asset(commonRows,[signal()],[1,2,3,4,5]),
   BBBUSDT:asset(commonRows,[signal()],undefined)
  },
  maxPositions:5,regimeCapPct:100,feeBps:0,slippageBps:0
 });
 assert.ok(result.skipped.some(x=>x.symbol==="BBBUSDT"&&x.reason.includes("CORRELATION_DATA_UNAVAILABLE")));
});

test("rejects assets whose OHLC timestamps are not aligned",()=>{
 const rows=[[100,101,99,100],[100,104,99,102]];
 assert.throws(()=>runPortfolioBacktest({assets:{
  AAAUSDT:asset(commonRows,[]),BBBUSDT:asset(rows,[])
 }}),RangeError);
});

test("reports marked ending equity separately from realized equity for open positions",()=>{
 const rows=[[100,101,99,100],[100,104,99,102],[102,104,101,103]];
 const result=runPortfolioBacktest({assets:{AAAUSDT:asset(rows,[signal()],[1,2,3])},feeBps:0,slippageBps:0});
 assert.equal(result.tradeCount,0);
 assert.equal(result.openPositions.length,1);
 assert.equal(result.realizedEndingEquity,result.initialCapital);
 assert.ok(result.markedEndingEquity>result.realizedEndingEquity);
 assert.equal(result.endingEquity,result.markedEndingEquity);
});

test("marked drawdown is reflected in portfolio equity while positions remain open",()=>{
 const rows=[[100,101,99,100],[100,101,97,98],[98,99,97,98],[98,99,97,98]];
 const result=runPortfolioBacktest({
  assets:{
   AAAUSDT:asset(rows,[signal(0)],[.01,.02,.03]),
   BBBUSDT:asset(rows,[signal(1)],[.02,.01,.03])
  },
  riskPct:50,ddLimitPct:1,ddRecoverPct:.5,regimeCapPct:100,maxPositions:3,
  feeBps:0,slippageBps:0
 });
 assert.ok(result.maxDrawdownPct>=1);
 assert.ok(result.skipped.some(x=>x.symbol==="BBBUSDT"&&x.reason==="DRAWDOWN_LIMIT_REACHED"));
});

test("rechecks marked drawdown after each same-bar portfolio entry",()=>{
 const rows=[[100,101,99,100],[100,101,97,98],[98,99,97,98]];
 const result=runPortfolioBacktest({
  assets:{
   AAAUSDT:asset(rows,[signal(0,2)],[.01,.02,.03]),
   BBBUSDT:asset(rows,[signal(0,1)],[.02,.01,.03])
  },
  riskPct:50,ddLimitPct:1,ddRecoverPct:.5,regimeCapPct:100,maxPositions:3,
  feeBps:0,slippageBps:0
 });
 assert.equal(result.trades.length,0);
 assert.ok(result.openPositions.some(x=>x.symbol==="AAAUSDT"));
 assert.ok(result.skipped.some(x=>x.symbol==="BBBUSDT"&&x.reason==="DRAWDOWN_LIMIT_REACHED"));
});

test("single-asset and one-symbol portfolio simulators agree on terminal marked equity",()=>{
 const rows=[[100,101,99,100],[100,104,99,102],[102,104,101,103]];
 const candles=bars(rows);
 const oneSignal=signal(0);
 const single=runEventBacktest({
  bars:candles,signals:[oneSignal],initialCapital:10000,riskPct:1,
  feeBps:10,slippageBps:5
 });
 const portfolio=runPortfolioBacktest({
  assets:{AAAUSDT:{bars:candles,signals:[oneSignal],dailyReturns:[.01,.02,.03]}},
  initialCapital:10000,riskPct:1,regimeCapPct:100,maxPositions:1,
  feeBps:10,slippageBps:5
 });
 assert.equal(single.tradeCount,0);
 assert.equal(portfolio.tradeCount,0);
 assert.ok(Math.abs(single.endingEquity-portfolio.endingEquity)<1e-8);
 assert.ok(Math.abs(single.markedEndingEquity-portfolio.markedEndingEquity)<1e-8);
});

test("single-asset and one-symbol portfolio simulators agree after partial exits and final closure",()=>{
 const rows=[[100,101,99,100],[100,104,99,102],[102,111,101,110],[110,116,101,114]];
 const candles=bars(rows);
 const oneSignal=signal(0);
 const single=runEventBacktest({
  bars:candles,signals:[oneSignal],initialCapital:10000,riskPct:1,
  feeBps:10,slippageBps:5
 });
 const portfolio=runPortfolioBacktest({
  assets:{AAAUSDT:{bars:candles,signals:[oneSignal],dailyReturns:[.01,.02,.03,.04]}},
  initialCapital:10000,riskPct:1,regimeCapPct:100,maxPositions:1,
  feeBps:10,slippageBps:5
 });
 assert.equal(single.tradeCount,1);
 assert.equal(portfolio.tradeCount,1);
 assert.ok(Math.abs(single.trades[0].netPnl-portfolio.trades[0].netPnl)<1e-8);
 assert.ok(Math.abs(single.endingEquity-portfolio.endingEquity)<1e-8);
});

test("single-asset and one-symbol portfolio agree on partial TP1 open-position accounting",()=>{
 const rows=[[100,101,99,100],[100,106,99,105],[105,106,102,104]];
 const candles=bars(rows),oneSignal=signal(0);
 const single=runEventBacktest({bars:candles,signals:[oneSignal],initialCapital:10000,riskPct:1,feeBps:12,slippageBps:7});
 const portfolio=runPortfolioBacktest({
  assets:{AAAUSDT:{bars:candles,signals:[oneSignal],dailyReturns:[.01,.02,.03]}},
  initialCapital:10000,riskPct:1,regimeCapPct:100,maxPositions:1,feeBps:12,slippageBps:7
 });
 assert.equal(single.tradeCount,0);
 assert.equal(portfolio.tradeCount,0);
 assert.equal(single.openPosition.remaining,.6);
 assert.equal(portfolio.openPositions[0].remaining,.6);
 assert.ok(Math.abs(single.endingEquity-portfolio.endingEquity)<1e-8);
});

test("single-asset and one-symbol portfolio agree on gap-through-stop fills",()=>{
 const rows=[[100,101,99,100],[100,103,99,102],[90,92,88,90],[90,92,89,91]];
 const candles=bars(rows),oneSignal=signal(0);
 const single=runEventBacktest({bars:candles,signals:[oneSignal],initialCapital:10000,riskPct:1,feeBps:12,slippageBps:7});
 const portfolio=runPortfolioBacktest({
  assets:{AAAUSDT:{bars:candles,signals:[oneSignal],dailyReturns:[.01,.02,.03,.04]}},
  initialCapital:10000,riskPct:1,regimeCapPct:100,maxPositions:1,feeBps:12,slippageBps:7
 });
 assert.equal(single.tradeCount,1);
 assert.equal(portfolio.tradeCount,1);
 assert.equal(single.trades[0].exitEvents[0].price,portfolio.trades[0].exitEvents[0].price);
 assert.ok(Math.abs(single.trades[0].netPnl-portfolio.trades[0].netPnl)<1e-8);
 assert.ok(Math.abs(single.endingEquity-portfolio.endingEquity)<1e-8);
});
