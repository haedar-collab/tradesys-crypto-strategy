import test from "node:test";
import assert from "node:assert/strict";
import { markPosition, calculateMarkedEquity, updateDrawdown } from "../src/backtest/mark-to-market.js";

const position = {
  symbol:"BTCUSDT", entryFill:100, quantity:10, remaining:0.5,
  entryFee:1, grossPnl:20, exitFees:0.5
};

test("marks open long position including realized partial exits and estimated liquidation costs",()=>{
  const result=markPosition(position,90,0.001,0.001);
  assert.equal(result.remainingQty,5);
  assert.equal(result.unrealizedGrossPnl,-50);
  assert.ok(result.estimatedExitFee>0);
  assert.ok(result.netContribution < -31);
});

test("marked portfolio equity includes all open-position contributions",()=>{
  const result=calculateMarkedEquity(10000,[position],{BTCUSDT:90},0,0);
  assert.equal(result.equity,9968.5);
});

test("drawdown peak follows marked equity, not just closed-trade balance",()=>{
  const first=updateDrawdown(10000,9200);
  assert.equal(first.peakEquity,10000);
  assert.equal(first.drawdownPct,8);
  const recovered=updateDrawdown(first.peakEquity,10200);
  assert.equal(recovered.peakEquity,10200);
  assert.equal(recovered.drawdownPct,0);
});

test("rejects missing marks and invalid inputs",()=>{
  assert.throws(()=>markPosition(position,NaN),TypeError);
  assert.throws(()=>calculateMarkedEquity(10000,[position],{}),TypeError);
});
