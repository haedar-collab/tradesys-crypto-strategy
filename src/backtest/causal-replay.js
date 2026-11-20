/**
 * Chronological, prefix-only replay for closed Binance Spot candles.
 * The evaluator receives a frozen copy of bars[0..index] only. It cannot
 * accidentally inspect later candles through the supplied replay context.
 */
import { prepareIndicators } from "../indicators/index.js";
import { structureEvents } from "../structure/events.js";
import { findBullishOrderBlocks, findBullishFvgs, findLiquidityLevels } from "../structure/zones.js";
import { buildRegimeTimeline } from "../regime/index.js";

function validateBars(bars) {
  if (!Array.isArray(bars) || bars.length < 2) throw new TypeError("at least two OHLCV bars are required");
  let previous = -Infinity;
  bars.forEach((bar, i) => {
    if (!bar || !Number.isFinite(bar.t) || bar.t <= previous) throw new RangeError(`bar ${i} timestamp must be finite and strictly increasing`);
    previous = bar.t;
    for (const key of ["o","h","l","c","v"]) {
      if (!Number.isFinite(bar[key])) throw new TypeError(`bar ${i} ${key} must be finite`);
    }
    if (bar.o <= 0 || bar.h <= 0 || bar.l <= 0 || bar.c <= 0 || bar.v < 0 ||
        bar.h < Math.max(bar.o,bar.c,bar.l) || bar.l > Math.min(bar.o,bar.c)) {
      throw new RangeError(`bar ${i} has invalid OHLCV relationships`);
    }
  });
}
function freezeBar(bar) { return Object.freeze({t:bar.t,o:bar.o,h:bar.h,l:bar.l,c:bar.c,v:bar.v}); }
function freezeDeep(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeDeep(child);
  return value;
}

export function runCausalReplay(bars, evaluator, options = {}) {
  validateBars(bars);
  if (typeof evaluator !== "function") throw new TypeError("causal evaluator function is required");
  const warmupBars = options.warmupBars ?? 2;
  if (!Number.isInteger(warmupBars) || warmupBars < 2) throw new RangeError("warmupBars must be an integer >= 2");
  const outputs = [];
  for (let index=warmupBars-1; index<bars.length; index++) {
    const prefix = Object.freeze(bars.slice(0,index+1).map(freezeBar));
    const result = evaluator(Object.freeze({bars:prefix,index,asOf:prefix[index].t}));
    outputs.push(Object.freeze({index,asOf:prefix[index].t,result:freezeDeep(result)}));
  }
  return {status:"COMPLETE",barCount:bars.length,replayedBars:outputs.length,outputs,
    assumptions:{informationSet:"evaluator receives only candles from index 0 through current index, inclusive",
      candlePolicy:"caller must supply fully closed candles; this module validates OHLCV shape but cannot independently verify exchange close status",
      execution:"signals evaluated at a candle close must not be filled at an earlier price within that same candle"}};
}

/**
 * Causal feature snapshot: every indicator, pivot, structure event, zone,
 * liquidity level and regime is recomputed from the current prefix only.
 */
export function runCausalFeatureReplay(bars, options = {}) {
  const parameters = options.indicatorParameters ?? {};
  const regimeParameters = options.regimeParameters ?? {};
  return runCausalReplay(bars, ({bars:prefix,index,asOf}) => {
    const series = {
      t:prefix.map(b=>b.t),o:prefix.map(b=>b.o),h:prefix.map(b=>b.h),
      l:prefix.map(b=>b.l),c:prefix.map(b=>b.c),v:prefix.map(b=>b.v)
    };
    const prepared = prepareIndicators({h:series.h,l:series.l,c:series.c,v:series.v},parameters);
    Object.assign(prepared,series);
    const structure = structureEvents(prepared,options.confirmationBars ?? 3);
    const orderBlocks = findBullishOrderBlocks(prepared,structure.events,options.orderBlockLookback ?? 150);
    const fvgs = findBullishFvgs(prepared,options.fvgLookback ?? 80);
    const currentAtr=prepared.atr[index],currentPrice=series.c[index];
    const liquidity = Number.isFinite(currentAtr) && currentAtr>0
      ? findLiquidityLevels(prepared,currentPrice,currentAtr,options.liquidityOptions)
      : null;
    const regimeTimeline = buildRegimeTimeline(prepared,regimeParameters);
    const rawRegime=regimeTimeline.raw[index];
    return {
      timestamp:asOf,close:currentPrice,indicators:{
        ema20:prepared.e20[index],ema50:prepared.e50[index],ema200:prepared.e200[index],
        rsi:prepared.rsi[index],atr:currentAtr,adx:prepared.adx[index],
        bb:prepared.bb[index],atrp:prepared.atrp[index]
      },
      structure:{events:structure.events.filter(e=>e.i<=index),trend:structure.trend,
        lastHigh:structure.lastHi,lastLow:structure.lastLo},
      orderBlocks,fvgs,liquidity,
      regime:{raw:rawRegime?.reg??null,effective:regimeTimeline.eff[index]??null}
    };
  },{warmupBars:options.warmupBars??2});
}

/**
 * Metamorphic test helper: mutate only candles at/after changedFrom and prove
 * all replay outputs strictly before that index remain identical.
 */
export function assertCausalPrefixInvariant(bars,evaluator,changedFrom,options={}) {
  validateBars(bars);
  if(!Number.isInteger(changedFrom)||changedFrom<1||changedFrom>=bars.length)
    throw new RangeError("changedFrom must identify a non-first bar within input");
  const original=runCausalReplay(bars,evaluator,options);
  const mutated=bars.map((bar,i)=>i<changedFrom?{...bar}:{...bar,c:bar.c*1.17,h:bar.h*1.17,l:bar.l*1.17,o:bar.o*1.17});
  const changed=runCausalReplay(mutated,evaluator,options);
  const before=(run)=>run.outputs.filter(x=>x.index<changedFrom);
  if(JSON.stringify(before(original))!==JSON.stringify(before(changed)))
    throw new Error("causal prefix invariant failed: future candles changed a prior replay output");
  return {status:"PASS",unchangedOutputs:before(original).length,changedFrom};
}

/**
 * Causal signal replay contract. buildDecisionInput sees only the current
 * closed prefix and its feature snapshot. evaluateSetup must be pure and deterministic.
 */
export function runCausalSignalReplay(bars,buildDecisionInput,evaluateSetup,options={}) {
  if(typeof buildDecisionInput!=="function"||typeof evaluateSetup!=="function")
    throw new TypeError("buildDecisionInput and evaluateSetup functions are required");
  return runCausalReplay(bars,({bars:prefix,index,asOf})=>{
    const featureReplay=runCausalFeatureReplay(prefix,{...options,warmupBars:prefix.length});
    const features=featureReplay.outputs[0]?.result??null;
    const decisionInput=buildDecisionInput(Object.freeze({bars:prefix,index,asOf,features}));
    if(!decisionInput||typeof decisionInput!=="object"||Array.isArray(decisionInput))
      throw new TypeError("buildDecisionInput must return a strategy input object");
    const decision=evaluateSetup(decisionInput);
    if(!decision||typeof decision!=="object"||Array.isArray(decision))
      throw new TypeError("evaluateSetup must return a decision object");
    return {decisionInput,decision};
  },options);
}
