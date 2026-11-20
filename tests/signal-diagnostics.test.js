import test from "node:test";import assert from "node:assert/strict";import {runSignalDiagnostics} from "../src/integration/signal-diagnostics.js";
const H=3600000,now=Date.UTC(2026,10,20,12);
function candles(n,step){return Array.from({length:n},(_,i)=>{const openTime=now-(n-i)*step,closeTime=openTime+step-1,close=100+i*.05;return {openTime,closeTime,open:close-.1,high:close+.5,low:close-.5,close,volume:1000+i,closed:true};});}
const input={weekly:candles(250,168*H),daily:candles(250,24*H),h4:candles(250,4*H),h1:candles(250,H)};
test("reports upstream timeframe biases and first blocking gate",()=>{const times=[now-3*H,now-2*H,now-H];const r=runSignalDiagnostics(input,times);assert.equal(r.status,"COMPLETE");assert.equal(r.evaluationCount,3);assert.equal(r.rows.length,3);assert.equal(Object.values(r.gateCounts).reduce((a,b)=>a+b,0),3);assert.ok(Object.keys(r.dailyBiasCounts).length>0);assert.ok(r.rows[0].regime.why);});
test("rejects unordered or empty evaluation schedules",()=>{assert.throws(()=>runSignalDiagnostics(input,[]),/non-empty/);assert.throws(()=>runSignalDiagnostics(input,[now,now-H]),/strictly increasing/);});
test("diagnostics do not alter strategy inputs",()=>{const before=structuredClone(input);runSignalDiagnostics(input,[now-H]);assert.deepEqual(input,before);});
