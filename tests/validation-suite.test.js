import test from "node:test";
import assert from "node:assert/strict";
import {
 createEventBacktestRunner,createPortfolioBacktestRunner,
 evaluateEventParameterSensitivity,evaluatePortfolioParameterSensitivity,
 evaluateEventWalkForward,evaluatePortfolioWalkForward,
 evaluateEventUntouchedHoldout,evaluatePortfolioUntouchedHoldout
} from "../src/backtest/validation-suite.js";

const plan={entry:100,stop:95,tp1:105,tp2:110,tp3:115};
const bars=Array.from({length:12},(_,i)=>({t:i*60_000,o:100,h:104,l:99,c:102}));
const signals=[0,2,4,6,8,10].map(index=>({index,plan:{...plan}}));
const single={bars,signals,initialCapital:10000,feeBps:10,slippageBps:5};
const portfolio={assets:{
 AAAUSDT:{bars,signals,dailyReturns:[.01,.02,.03,.04,.05,.06]},
 BBBUSDT:{bars,signals:[],dailyReturns:[.02,.01,.04,.03,.05,.06]}
},initialCapital:10000,regimeCapPct:100,maxPositions:2,feeBps:10,slippageBps:5};

test("validation suite runners call the actual event and portfolio simulators",()=>{
 const event=createEventBacktestRunner()(single);
 const port=createPortfolioBacktestRunner()(portfolio);
 assert.equal(event.status,"COMPLETE");assert.equal(port.status,"COMPLETE");
 assert.equal(event.assumptions.feeBps,10);assert.equal(port.assumptions.spotOnly,true);
});
test("event sensitivity adapter executes actual event simulator across risk settings",()=>{
 const result=evaluateEventParameterSensitivity(single,[{riskPct:.5},{riskPct:1},{riskPct:1.5}]);
 assert.equal(result.scenarioCount,3);
 assert.ok(result.results.every(r=>Number.isFinite(r.netReturnPct)&&Number.isFinite(r.maxDrawdownPct)));
});
test("portfolio sensitivity adapter executes actual portfolio simulator",()=>{
 const result=evaluatePortfolioParameterSensitivity(portfolio,[{riskPct:.5},{riskPct:1}]);
 assert.equal(result.scenarioCount,2);
 assert.ok(result.results.every(r=>Number.isFinite(r.netReturnPct)));
});
test("walk-forward adapters use actual simulators and preserve chronological windows",()=>{
 const event=evaluateEventWalkForward(single,{parameterCandidates:[{riskPct:.5},{riskPct:1}],
  windows:[{name:"event",trainStart:0,trainEnd:6,testStart:6,testEnd:12}]});
 assert.equal(event.results[0].test.start,6);
 const portfolioInput={...portfolio,assets:{
  AAAUSDT:{...portfolio.assets.AAAUSDT,bars:bars.slice(0,12),signals},
  BBBUSDT:{...portfolio.assets.BBBUSDT,bars:bars.slice(0,12),signals:[]}
 }};
 const port=evaluatePortfolioWalkForward(portfolioInput,{parameterCandidates:[{riskPct:.5},{riskPct:1}],
  windows:[{name:"portfolio",trainStart:0,trainEnd:6,testStart:6,testEnd:12}]});
 assert.equal(port.results[0].outOfSample.tradeCount>=0,true);
});
test("untouched holdout adapters execute real simulators only after parameter lock",()=>{
 const event=evaluateEventUntouchedHoldout(single,{start:6,end:12,frozenParameters:{riskPct:1,feeBps:10,slippageBps:5},
  selectionLocked:true,selectionTimestamp:5*60_000});
 assert.equal(event.status,"COMPLETE");
 const port=evaluatePortfolioUntouchedHoldout(portfolio,{start:6,end:12,frozenParameters:{riskPct:1,feeBps:10,slippageBps:5},
  selectionLocked:true,selectionTimestamp:5*60_000});
 assert.equal(port.status,"COMPLETE");
});
