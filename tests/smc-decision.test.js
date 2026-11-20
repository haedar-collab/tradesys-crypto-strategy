import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSmcSetup } from "../src/structure/decision.js";

function input(overrides={}) {
 return {
  dailyBias:"Bullish",trend4h:"Bullish",price:96,close4h:96,atr4h:2,
  zone:{lo:95,hi:97},
  zoneQuality:{quality:"Strong",fresh:true},
  obFvgOverlap:true,discount:true,rejection4h:true,
  plan:{entry:96,stop:94,tp1:99,tp2:102},
  ...overrides
 };
}

test("allows a research candidate only with bullish HTF, valid zone, trigger and R:R",()=>{
 const result=evaluateSmcSetup(input(),{minRR:1.5});
 assert.equal(result.status,"BUY_CANDIDATE");
 assert.equal(result.candidate,true);
 assert.ok(result.evidence.includes("FRESH_ZONE"));
 assert.ok(result.evidence.includes("OB_FVG_CONFLUENCE"));
 assert.equal(result.plan.plannedRR,3);
 assert.match(result.disclaimer,/No order execution/);
});

test("blocks non-bullish Daily bias and bearish 4H structure",()=>{
 assert.ok(evaluateSmcSetup(input({dailyBias:"Neutral"})).reasons.includes("DAILY_BIAS_NOT_BULLISH"));
 assert.ok(evaluateSmcSetup(input({trend4h:"Bearish"})).reasons.includes("FOUR_HOUR_STRUCTURE_BEARISH"));
});

test("blocks invalidated or weak zones",()=>{
 assert.ok(evaluateSmcSetup(input({close4h:94.9})).reasons.includes("DEMAND_ZONE_INVALIDATED"));
 assert.ok(evaluateSmcSetup(input({zoneQuality:{quality:"Weak"}})).reasons.includes("ZONE_QUALITY_WEAK"));
});

test("waits when price is outside zone without a confirmed 1H trigger",()=>{
 const result=evaluateSmcSetup(input({price:100,rejection4h:true}));
 assert.equal(result.status,"WAIT");
 assert.ok(result.reasons.includes("PRICE_NOT_IN_ZONE"));
});

test("accepts a fresh 1H confirmation only when chase distance and live R:R remain valid",()=>{
 const good=evaluateSmcSetup(input({price:99,rejection4h:false,ltf:{state:"confirmed",trigger:"1H BOS",close:99}}),{minRR:1.5});
 assert.equal(good.status,"BUY_CANDIDATE");
 const far=evaluateSmcSetup(input({price:101,rejection4h:false,ltf:{state:"confirmed",trigger:"1H BOS",close:101}}),{minRR:1.5});
 assert.ok(far.reasons.includes("LTF_TRIGGER_TOO_FAR_FROM_ZONE"));
});

test("waits when current reward-to-risk is below minimum even if planned R:R passes",()=>{
 const result=evaluateSmcSetup(input({price:96,plan:{entry:96,stop:94,tp1:97,tp2:98}}),{minRR:1.5});
 assert.ok(result.reasons.includes("PLANNED_RR_BELOW_MINIMUM"));
});

test("fails closed on missing or invalid context",()=>{
 assert.equal(evaluateSmcSetup({}).status,"WAIT_DATA");
 assert.equal(evaluateSmcSetup(input({ltf:{state:"confirmed"}})).status,"WAIT_DATA");
});
