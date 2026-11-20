import test from "node:test";
import assert from "node:assert/strict";
import { runPortfolioStress } from "../src/backtest/portfolio-stress.js";

const plan={entry:100,stop:95,tp1:105,tp2:110,tp3:115};
const rows=[[100,101,99,100],[100,101,99,100],[100,101,99,100],[100,101,99,100]];
const bars=rows.map((r,i)=>({t:i*60000,o:r[0],h:r[1],l:r[2],c:r[3]}));
const input={initialCapital:10000,feeBps:0,slippageBps:0,riskPct:1,regimeCapPct:100,maxPositions:2,
 assets:{AAAUSDT:{bars,signals:[{index:0,plan:{...plan}}],dailyReturns:[.01,.02,.03,.04]}}};

test("runs baseline and downside price shocks without mutating input",()=>{
 const before=structuredClone(input);
 const result=runPortfolioStress(input,[
  {name:"baseline-path",shockIndex:2,shocks:{}},
  {name:"single-asset-down-8",shockIndex:2,shocks:{AAAUSDT:-8}},
  {name:"single-asset-down-20",shockIndex:2,shocks:{AAAUSDT:-20}}
 ]);
 assert.equal(result.status,"COMPLETE");
 assert.equal(result.scenarioCount,3);
 assert.ok(result.results[2].endingEquity<=result.results[1].endingEquity);
 assert.deepEqual(input,before);
});

test("rejects duplicate names, unknown symbols, and invalid shock magnitudes",()=>{
 assert.throws(()=>runPortfolioStress(input,[
  {name:"same",shockIndex:2,shocks:{}},{name:"same",shockIndex:2,shocks:{}}
 ]),RangeError);
 assert.throws(()=>runPortfolioStress(input,[{name:"unknown",shockIndex:2,shocks:{NOPE:-5}}]),RangeError);
 assert.throws(()=>runPortfolioStress(input,[{name:"invalid",shockIndex:2,shocks:{AAAUSDT:-100}}]),RangeError);
});

test("rejects invalid scenario arrays and runner output",()=>{
 assert.throws(()=>runPortfolioStress(input,[]),TypeError);
 assert.throws(()=>runPortfolioStress(input,[{name:"bad",shockIndex:2,shocks:{}}],()=>({})),TypeError);
});
