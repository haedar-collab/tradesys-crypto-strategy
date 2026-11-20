import test from "node:test";
import assert from "node:assert/strict";
import { buildEquitySnapshot, markedDrawdownGate } from "../src/backtest/equity-curve.js";

const open = {
  symbol:"BTCUSDT", entryFill:100, quantity:10, remaining:1,
  entryFee:1, grossPnl:0, exitFees:0
};

test("equity snapshot includes unrealized loss and updates high-water drawdown",()=>{
  const snapshot=buildEquitySnapshot({
    timestamp:1000,realizedEquity:10000,positions:[open],marks:{BTCUSDT:90},
    previousPeakEquity:10000,feeRate:0,slippageRate:0
  });
  assert.equal(snapshot.markedEquity,9899);
  assert.equal(snapshot.drawdownPct,1.01);
  assert.equal(snapshot.peakEquity,10000);
});

test("marked drawdown gate blocks new entries at the configured threshold",()=>{
  const snapshot={drawdownPct:10};
  assert.equal(markedDrawdownGate(snapshot,10).allowNewEntries,false);
  assert.equal(markedDrawdownGate(snapshot,10).state,"BLOCKED");
});

test("marked drawdown gate permits entries below threshold",()=>{
  assert.equal(markedDrawdownGate({drawdownPct:9.99},10).allowNewEntries,true);
});

test("snapshot is deterministic for the same timestamp and inputs",()=>{
  const args={timestamp:2000,realizedEquity:10000,positions:[open],
    marks:{BTCUSDT:110},previousPeakEquity:10000};
  assert.deepEqual(buildEquitySnapshot(args),buildEquitySnapshot(args));
});
