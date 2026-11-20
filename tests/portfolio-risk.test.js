import test from "node:test";
import assert from "node:assert/strict";
import { calculatePositionSize, evaluatePortfolioRisk, pearsonCorrelation } from "../src/risk/portfolio.js";

test("sizes spot position from fixed fractional risk and stop distance",()=>{
 const r=calculatePositionSize({equity:10000,riskPct:1,entry:100,stop:95});
 assert.equal(r.status,"SIZED");
 assert.equal(r.size,2000);
 assert.equal(r.riskUsd,100);
 assert.equal(r.sizePct,20);
});

test("applies regime, drawdown and event multipliers before exposure cap",()=>{
 const r=calculatePositionSize({equity:10000,riskPct:1,entry:100,stop:95,regimeMultiplier:.5,drawdownMultiplier:.5,eventMultiplier:.5,availableExposure:500});
 assert.equal(r.size,500);
 assert.equal(r.riskUsd,25);
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
  openPositions:[{symbol:"BBBUSDT",size:2000}],pendingSignals:[{symbol:"CCCUSDT",size:1500}]});
 assert.equal(r.status,"ALLOWED");
 assert.equal(r.freeUsd,1500);
 assert.equal(r.slots,1);
});

test("blocks when exposure or position slots are exhausted",()=>{
 const exposure=evaluatePortfolioRisk({equity:10000,regimeCapPct:50,maxPositions:5,candidateSymbol:"AAAUSDT",
  openPositions:[{symbol:"BBBUSDT",size:5000}]});
 assert.ok(exposure.reasons.includes("REGIME_EXPOSURE_CAP_REACHED"));
 const slots=evaluatePortfolioRisk({equity:10000,regimeCapPct:80,maxPositions:1,candidateSymbol:"AAAUSDT",
  openPositions:[{symbol:"BBBUSDT",size:1000}]});
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
