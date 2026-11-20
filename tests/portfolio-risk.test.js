import test from "node:test";
import assert from "node:assert/strict";
import { calculatePositionSize, evaluatePortfolioRisk, pearsonCorrelation, evaluateDrawdownRisk } from "../src/risk/portfolio.js";

test("sizes spot position from fixed fractional risk and stop distance",()=>{
 const r=calculatePositionSize({equity:10000,riskPct:1,entry:100,stop:95});
 assert.equal(r.status,"SIZED");
 assert.equal(r.size,2000);
 assert.equal(r.riskUsd,100);
 assert.equal(r.sizePct,20);
});

test("applies regime, drawdown and event multipliers before exposure cap",()=>{
 const r=calculatePositionSize({equity:10000,riskPct:1,entry:100,stop:95,regimeMultiplier:.5,drawdownMultiplier:.5,eventMultiplier:.5,availableExposure:100});
 assert.equal(r.size,100);
 assert.equal(r.riskUsd,5);
 assert.ok(r.reasons.includes("CAPPED_BY_AVAILABLE_EXPOSURE"));
});

test("blocks invalid stop geometry and returns zero size",()=>{
 const r=calculatePositionSize({equity:10000,riskPct:1,entry:100,stop:100});
 assert.equal(r.status,"BLOCKED");
 assert.equal(r.size,0);
});

test("calculates Pearson correlation and handles constant series",()=>{
 assert.equal(pearsonCorrelation([1,2,3],[2,4,6]),1);
 assert.equal(pearsonCorrelation([1,1,1],[2,3,4]),null);
});

test("enforces regime exposure and position-count caps",()=>{
 const r=evaluatePortfolioRisk({equity:10000,regimeCapPct:50,maxPositions:3,candidateSymbol:"AAAUSDT",
  openPositions:[{symbol:"BBBUSDT",size:2000}],pendingSignals:[{symbol:"CCCUSDT",size:1500}],enforceCorrelation:false});
 assert.equal(r.status,"ALLOWED");
 assert.equal(r.freeUsd,1500);
 assert.equal(r.slots,1);
});

test("blocks when exposure or position slots are exhausted",()=>{
 const exposure=evaluatePortfolioRisk({equity:10000,regimeCapPct:50,maxPositions:5,candidateSymbol:"AAAUSDT",
  openPositions:[{symbol:"BBBUSDT",size:5000}],enforceCorrelation:false});
 assert.ok(exposure.reasons.includes("REGIME_EXPOSURE_CAP_REACHED"));
 const slots=evaluatePortfolioRisk({equity:10000,regimeCapPct:80,maxPositions:1,candidateSymbol:"AAAUSDT",
  openPositions:[{symbol:"BBBUSDT",size:1000}],enforceCorrelation:false});
 assert.ok(slots.reasons.includes("MAX_POSITIONS_REACHED"));
});

test("blocks duplicate symbols even when daily return data is unavailable",()=>{
 const r=evaluatePortfolioRisk({equity:10000,regimeCapPct:80,maxPositions:5,candidateSymbol:"AAAUSDT",
  openPositions:[{symbol:"AAAUSDT",size:1000}]});
 assert.ok(r.reasons.includes("SYMBOL_ALREADY_ACTIVE"));
});

test("blocks highly correlated assets against active positions",()=>{
 const r=evaluatePortfolioRisk({equity:10000,regimeCapPct:80,maxPositions:5,candidateSymbol:"AAAUSDT",corrMax:.8,
  candidateReturns:[1,2,3,4,5],
  openPositions:[{symbol:"BBBUSDT",size:1000,dailyReturns:[2,4,6,8,10]}]});
 assert.equal(r.correlatedWith,"BBBUSDT");
 assert.ok(r.reasons.includes("CORRELATED_WITH_ACTIVE_POSITION"));
});

test("fails closed for missing portfolio context",()=>{
 assert.equal(evaluatePortfolioRisk({}).status,"WAIT_DATA");
});

test("fails closed when correlation is enabled but aligned return history is missing",()=>{
 const r=evaluatePortfolioRisk({equity:10000,regimeCapPct:80,maxPositions:5,candidateSymbol:"AAAUSDT",
  openPositions:[{symbol:"BBBUSDT",size:1000}]});
 assert.ok(r.reasons.includes("CORRELATION_DATA_UNAVAILABLE"));
 assert.equal(r.allowed,false);
});

test("rejects risk budgets above 100 percent of equity",()=>{
 const r=calculatePositionSize({equity:10000,riskPct:150,entry:100,stop:95});
 assert.equal(r.status,"BLOCKED");
});

test("drawdown guard reduces risk, blocks at limit, and recovers with hysteresis",()=>{
 const normal=evaluateDrawdownRisk({equity:10000,peakEquity:10000});
 assert.equal(normal.state,"NORMAL");
 const reduced=evaluateDrawdownRisk({equity:9400,peakEquity:10000});
 assert.equal(reduced.state,"REDUCED");
 assert.equal(reduced.multiplier,.5);
 const blocked=evaluateDrawdownRisk({equity:8900,peakEquity:10000});
 assert.equal(blocked.state,"BLOCKED");
 assert.equal(blocked.allowNewEntries,false);
 const stillBlocked=evaluateDrawdownRisk({equity:9200,peakEquity:10000,previousState:"BLOCKED"});
 assert.equal(stillBlocked.state,"BLOCKED");
 const recovered=evaluateDrawdownRisk({equity:9500,peakEquity:10000,previousState:"BLOCKED"});
 assert.equal(recovered.state,"NORMAL");
});

test("fails closed on invalid drawdown thresholds",()=>{
 const result=evaluateDrawdownRisk({equity:9000,peakEquity:10000,ddLimitPct:5,ddRecoverPct:5});
 assert.equal(result.allowNewEntries,false);
 assert.equal(result.state,"UNKNOWN");
});
