import test from "node:test";
import assert from "node:assert/strict";
import { createWalkForwardFolds } from "../src/backtest/walk-forward-folds.js";

test("creates expanding chronological folds with explicit purge and embargo gap",()=>{
 const plan=createWalkForwardFolds({barCount:100,initialTrainBars:40,testBars:10,stepBars:10,purgeBars:3,embargoBars:2});
 assert.equal(plan.foldCount,5);
 for(const fold of plan.folds){
  assert.ok(fold.trainStart<fold.trainEnd);
  assert.equal(fold.trainEnd,fold.testStart-5);
  assert.equal(fold.testEnd-fold.testStart,10);
  assert.ok(fold.testEnd<=100);
 }
 assert.equal(plan.folds[0].trainStart,0);
 assert.equal(plan.folds[1].trainStart,0);
});

test("creates rolling windows with fixed training length",()=>{
 const plan=createWalkForwardFolds({barCount:120,initialTrainBars:50,testBars:10,stepBars:10,mode:"rolling",rollingTrainBars:30});
 assert.equal(plan.folds[0].trainEnd-plan.folds[0].trainStart,30);
 assert.equal(plan.folds[1].trainEnd-plan.folds[1].trainStart,30);
 assert.ok(plan.folds[1].trainStart>plan.folds[0].trainStart);
});

test("rejects invalid fold configuration and insufficient history",()=>{
 assert.throws(()=>createWalkForwardFolds({barCount:30,initialTrainBars:25,testBars:10}),/not enough bars/);
 assert.throws(()=>createWalkForwardFolds({barCount:100,initialTrainBars:40,testBars:10,purgeBars:-1}),/invalid integer/);
 assert.throws(()=>createWalkForwardFolds({barCount:100,initialTrainBars:40,testBars:10,mode:"rolling"}),/rollingTrainBars/);
});

test("folds preserve chronological ordering and do not overlap train and test",()=>{
 const plan=createWalkForwardFolds({barCount:200,initialTrainBars:60,testBars:20,stepBars:15,purgeBars:5,embargoBars:3});
 for(let i=0;i<plan.folds.length;i++){
  const f=plan.folds[i];
  assert.ok(f.trainEnd<=f.exclusion.start);
  assert.equal(f.exclusion.end,f.testStart);
  assert.ok(f.trainEnd<f.testStart);
  if(i) assert.ok(f.testStart>plan.folds[i-1].testStart);
 }
});
