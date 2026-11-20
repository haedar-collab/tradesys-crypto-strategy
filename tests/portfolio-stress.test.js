import test from "node:test";
import assert from "node:assert/strict";
import { runPortfolioStress } from "../src/backtest/portfolio-stress.js";

const makeBars=()=>[[100,101,99,100],[100,101,99,100],[100,101,99,100],[100,101,99,100],[100,101,99,100]].map((r,i)=>({t:i*60000,o:r[0],h:r[1],l:r[2],c:r[3]}));
const plan={entry:100,stop:95,tp1:105,tp2:110,tp3:115};
const input={initialCapital:10000,feeBps:0,slippageBps:0,riskPct:1,regimeCapPct:100,maxPositions:3,
 assets:{
  AAAUSDT:{bars:makeBars(),signals:[{index:0,plan:{...plan}}],dailyReturns:[.01,.02,.03,.04]},
  BBBUSDT:{bars:makeBars(),signals:[],dailyReturns:[-.01,-.02,-.03,-.04]},
  CCCUSDT:{bars:makeBars(),signals:[],dailyReturns:[.02,-.01,.04,-.02]}
 }};
test("runs adverse shocks, preserves baseline input, and increases downside loss",()=>{
 const before=structuredClone(input);
 const r=runPortfolioStress(input,[
  {name:"base",shockIndex:2,shocks:{}},
  {name:"down8",shockIndex:2,shocks:{AAAUSDT:-8}},
  {name:"down20",shockIndex:2,shocks:{AAAUSDT:-20}}
 ]);
 assert.equal(r.status,"COMPLETE");assert.equal(r.scenarioCount,3);
 assert.ok(r.results[2].endingEquity<=r.results[1].endingEquity);
 assert.deepEqual(input,before);
});
test("correlation stress blends return series toward a common market factor",()=>{
 const r=runPortfolioStress(input,[{name:"correlation",shockIndex:2,shocks:{},correlationBlend:1}]);
 assert.ok(r.results[0].correlation.averagePairwiseCorrelation>0.999999);
 assert.equal(r.results[0].correlation.pairCount,3);
});
test("supports a linear price recovery to baseline factor",()=>{
 const r=runPortfolioStress(input,[{name:"recovery",shockIndex:1,recoveryEndIndex:4,shocks:{AAAUSDT:-20}}]);
 assert.equal(r.results[0].recoveryEndIndex,4);
});
test("rejects invalid correlation, recovery, duplicate, symbol and shock inputs",()=>{
 assert.throws(()=>runPortfolioStress(input,[{name:"bad-corr",shockIndex:2,shocks:{},correlationBlend:1.1}]),RangeError);
 assert.throws(()=>runPortfolioStress(input,[{name:"bad-recovery",shockIndex:2,recoveryEndIndex:2,shocks:{}}]),RangeError);
 assert.throws(()=>runPortfolioStress(input,[{name:"same",shockIndex:2,shocks:{}},{name:"same",shockIndex:2,shocks:{}}]),RangeError);
 assert.throws(()=>runPortfolioStress(input,[{name:"unknown",shockIndex:2,shocks:{NOPE:-5}}]),RangeError);
 assert.throws(()=>runPortfolioStress(input,[{name:"invalid",shockIndex:2,shocks:{AAAUSDT:-100}}]),RangeError);
});
test("rejects missing or mismatched correlation data and invalid runner output",()=>{
 assert.throws(()=>runPortfolioStress(input,[{name:"corr",shockIndex:2,shocks:{},correlationBlend:.5}],()=>({})),TypeError);
 const broken=structuredClone(input);delete broken.assets.BBBUSDT.dailyReturns;
 assert.throws(()=>runPortfolioStress(broken,[{name:"corr",shockIndex:2,shocks:{},correlationBlend:.5}]),TypeError);
});
