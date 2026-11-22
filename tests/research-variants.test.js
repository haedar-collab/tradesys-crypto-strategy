import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMultiTimeframeSetup } from "../src/engine/multi-timeframe.js";
import { advanceLongPosition } from "../src/risk/trade-plan.js";
import { runEventBacktest } from "../src/backtest/event-driven.js";

function h4Series() {
  const n=40, o=Array(n).fill(100), c=Array(n).fill(100), h=Array(n).fill(101), l=Array(n).fill(99);
  return {n,t:Array.from({length:n},(_,i)=>i),o,c,h,l,atr:Array(n).fill(1)};
}
function h1Series() {
  const n=80, o=Array(n).fill(96), c=Array(n).fill(96), h=Array(n).fill(96.4), l=Array(n).fill(95.8);
  l[70]=95.9; h[68]=96.5;
  for(let i=72;i<n;i++){o[i]=97;c[i]=97.5;h[i]=98;l[i]=96.8;}
  return {n,t:Array.from({length:n},(_,i)=>i),ct:Array.from({length:n},(_,i)=>i),o,c,h,l,atr:Array(n).fill(.5),piv:{hi:[68],lo:[66]}};
}
const context = regime => ({
  weekly:{closed:true,trend:"Bullish"}, daily:{bias:"Bullish"}, regime,
  h4:{ price:96.5,close:96.5,atr:1,trend:"Bullish",rangeEquilibrium:99, series:h4Series(),
    orderBlocks:[{lo:95,hi:97,idx:10,from:11,t:10}], fvgs:[{lo:96,hi:96.5,idx:12}], targetLevels:[100,105,110], rejection:false },
  h1:{series:h1Series()}
});

test("V1: default still requires a confirmed regime; the option allows it but keeps blocking a raw downtrend", () => {
  const unconfirmed = context({ raw: "Sideways", effective: "Uptrend", confirmed: false });
  assert.ok(evaluateMultiTimeframeSetup(unconfirmed).reasons.includes("MARKET_REGIME_UNCONFIRMED"));
  const relaxed = evaluateMultiTimeframeSetup(unconfirmed, { requireConfirmedRegime: false });
  assert.ok(!relaxed.reasons.includes("MARKET_REGIME_UNCONFIRMED"));
  const turningDown = context({ raw: "Downtrend", effective: "Uptrend", confirmed: false });
  assert.ok(evaluateMultiTimeframeSetup(turningDown, { requireConfirmedRegime: false }).reasons.includes("MARKET_REGIME_DOWNTREND"));
  const confirmedDown = context({ raw: "Downtrend", effective: "Downtrend", confirmed: true });
  assert.ok(evaluateMultiTimeframeSetup(confirmedDown, { requireConfirmedRegime: false }).reasons.includes("MARKET_REGIME_DOWNTREND"));
});

const position = { entry: 100, stop: 95, tp1: 105, tp2: 110, tp3: 120, stage: 0, remaining: 1, status: "OPEN" };

test("V2: SINGLE_TP2 ignores TP1, never moves the stop and exits everything at TP2", () => {
  const atTp1 = advanceLongPosition(position, { low: 101, high: 106 }, { exitModel: "SINGLE_TP2" });
  assert.equal(atTp1.status, "OPEN");
  assert.deepEqual(atTp1.exits, []);
  assert.equal(atTp1.stop, 95);
  const atTp2 = advanceLongPosition(atTp1, { low: 104, high: 111 }, { exitModel: "SINGLE_TP2" });
  assert.equal(atTp2.status, "CLOSED");
  assert.deepEqual(atTp2.exits, [{ fraction: 1, price: 110, reason: "TP2" }]);
  // Ambiguous bar touching both: stop first.
  const both = advanceLongPosition(position, { low: 94, high: 111 }, { exitModel: "SINGLE_TP2" });
  assert.deepEqual(both.exits, [{ fraction: 1, price: 95, reason: "STOP_LOSS" }]);
  assert.throws(() => advanceLongPosition(position, { low: 99, high: 101 }, { exitModel: "NOPE" }), /unknown exit model/);
  // Default model unchanged: TP1 partial and stop to entry.
  const scale = advanceLongPosition(position, { low: 101, high: 106 });
  assert.equal(scale.exits[0].reason, "TP1");
  assert.equal(scale.stop, 100);
});

test("V2: event backtest honours exitModel (one exit event at TP2 vs scale-out)", () => {
  const bars = [
    { t: 0, o: 100, h: 100.5, l: 99.5, c: 100 },
    { t: 1, o: 100, h: 101, l: 99.6, c: 100.5 },
    { t: 2, o: 100.5, h: 106, l: 100.4, c: 105 },
    { t: 3, o: 105, h: 111, l: 104.5, c: 110 }
  ];
  const signals = [{ index: 0, plan: { entry: 100, stop: 95, tp1: 105, tp2: 110, tp3: 120 } }];
  const single = runEventBacktest({ bars, signals, exitModel: "SINGLE_TP2", feeBps: 0, slippageBps: 0 });
  assert.equal(single.trades.length, 1);
  assert.deepEqual(single.trades[0].exitEvents.map(e => e.reason), ["TP2"]);
  const scale = runEventBacktest({ bars, signals, feeBps: 0, slippageBps: 0 });
  // Scale-out: TP1 and TP2 partials, 20% still open waiting for TP3.
  assert.equal(scale.trades.length, 0);
  assert.ok(Math.abs(scale.openPosition.remaining - 0.2) < 1e-9);
});
