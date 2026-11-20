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
 const rows=[[100,101,99,100],[100,104,99,102],[102,106,101,105],[105,106,102,104]];
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

test("single-asset and one-symbol portfolio share drawdown reduction before the next entry",()=>{
 const rows=[[100,101,99,100],[100,101,93,94],[100,101,99,100],[100,101,99,100],[100,101,99,100]];
 const candles=bars(rows);
 const widerPlan={entry:100,stop:94,tp1:106,tp2:112,tp3:118};
 const signals=[{index:0,plan:{...widerPlan}},{index:1,plan:{...widerPlan}}];
 const config={initialCapital:10000,riskPct:10,ddLimitPct:10,ddRecoverPct:5,ddReducedMultiplier:.5,feeBps:0,slippageBps:0};
 const single=runEventBacktest({...config,bars:candles,signals});
 const portfolio=runPortfolioBacktest({
  ...config,assets:{AAAUSDT:{bars:candles,signals,dailyReturns:[.01,.02,.03,.04,.05]}},
  regimeCapPct:100,maxPositions:1
 });
 assert.equal(single.tradeCount,1);
 assert.equal(portfolio.tradeCount,1);
 assert.equal(single.assumptions.drawdownGuard.state,"REDUCED");
 assert.equal(portfolio.assumptions.drawdownGuard.state,"REDUCED");
 assert.ok(Math.abs(single.openPosition.notional-portfolio.openPositions[0].notional)<1e-8);
 assert.ok(Math.abs(single.openPosition.notional-9400*10*.5/100/0.06)<1e-8);
});

test("blocks new entries after simultaneous losses across multiple active positions breach portfolio drawdown",()=>{
 const rows=[
  [100,101,99,100],
  [100,101,99,100],
  [100,101,90,95],
  [95,96,94,95]
 ];
 const result=runPortfolioBacktest({
  assets:{
   AAAUSDT:asset(rows,[signal(0)],[1,2,3,4]),
   BBBUSDT:asset(rows,[signal(0)],[4,3,2,1]),
   CCCUSDT:asset(rows,[signal(1)],[1,3,2,4])
  },
  initialCapital:10000,riskPct:2,ddLimitPct:3,ddRecoverPct:1.5,
  regimeCapPct:90,maxPositions:3,corrMax:.8,feeBps:0,slippageBps:0
 });
 assert.equal(result.tradeCount,2);
 assert.deepEqual(result.trades.map(t=>t.symbol).sort(),["AAAUSDT","BBBUSDT"]);
 assert.equal(result.trades.reduce((sum,t)=>sum+t.netPnl,0),-400);
 assert.ok(result.maxDrawdownPct>=4);
 assert.ok(result.skipped.some(x=>x.symbol==="CCCUSDT"&&x.reason==="DRAWDOWN_LIMIT_REACHED"));
 assert.equal(result.assumptions.drawdownGuard.state,"BLOCKED");
});

test("marks combined open-position losses before allowing another portfolio entry",()=>{
 const rows=[
  [100,101,99,100],
  [100,101,99,100],
  [100,101,97,98],
  [98,99,97,98]
 ];
 const result=runPortfolioBacktest({
  assets:{
   AAAUSDT:asset(rows,[signal(0)],[1,2,3,4]),
   BBBUSDT:asset(rows,[signal(0)],[4,3,2,1]),
   CCCUSDT:asset(rows,[signal(1)],[1,3,2,4])
  },
  initialCapital:10000,riskPct:2,ddLimitPct:1,ddRecoverPct:.5,
  regimeCapPct:90,maxPositions:3,corrMax:.8,feeBps:0,slippageBps:0
 });
 assert.equal(result.tradeCount,0);
 assert.equal(result.openPositions.length,2);
 assert.ok(result.maxDrawdownPct>=1);
 assert.ok(result.skipped.some(x=>x.symbol==="CCCUSDT"&&x.reason==="DRAWDOWN_LIMIT_REACHED"));
 assert.equal(result.assumptions.drawdownGuard.state,"BLOCKED");
});
