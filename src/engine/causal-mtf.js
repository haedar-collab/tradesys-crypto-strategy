/**
 * Strict as-of Weekly/Daily/4H/1H context builder for Binance Spot klines.
 * Only candles with closeTime < evaluationTime are admitted.
 */
import { normalizeCandles, toSeries } from "../validation/candles.js";
import { prepareIndicators } from "../indicators/index.js";
import { structureEvents } from "../structure/events.js";
import { findBullishOrderBlocks, findBullishFvgs, findLiquidityLevels } from "../structure/zones.js";
import { buildRegimeTimeline } from "../regime/index.js";
import { validateMultiTimeframeAsOf } from "../validation/timeframes.js";
import { evaluateMultiTimeframeSetup } from "./multi-timeframe.js";

export const CAUSAL_MTF_INTERVALS = Object.freeze({weekly:604800000,daily:86400000,h4:14400000,h1:3600000});
const trendLabel = value => value>0?"Bullish":value<0?"Bearish":"Neutral";

function prepareClosedTimeframe(rows,key,evaluationTime,options) {
  const intervalMs=options.intervals?.[key]??CAUSAL_MTF_INTERVALS[key];
  const normalized=normalizeCandles(rows,{now:evaluationTime,intervalMs,
    requireContiguous:options.requireContiguous===true,allowForming:false});
  if(normalized.status==="FAIL") return {status:"FAIL",timeframe:key,errors:normalized.errors,warnings:normalized.warnings};
  const candles=normalized.candles.filter(c=>c.closed===true&&c.closeTime<evaluationTime);
  const minimum=options.minimumBars?.[key]??(key==="h1"?60:key==="h4"?30:30);
  if(candles.length<minimum) return {status:"WAIT",timeframe:key,reason:"INSUFFICIENT_CLOSED_CANDLES",
    availableBars:candles.length,requiredBars:minimum,warnings:normalized.warnings};
  const series=toSeries(candles);
  const prepared=prepareIndicators({h:series.h,l:series.l,c:series.c,v:series.v},options.indicatorParameters);
  Object.assign(prepared,series);
  const structure=structureEvents(prepared,options.confirmationBars??3);
  const latest=candles.length-1;
  return {status:"PASS",timeframe:key,candles,series,prepared,structure,asOf:candles[latest].closeTime,
    price:series.c[latest],atr:prepared.atr[latest],warnings:normalized.warnings};
}

function frameEvidence(frame) {
  const last=frame.candles.length-1,p=frame.prepared,s=frame.structure;
  const finite=x=>Number.isFinite(x)?x:null;
  const e50=finite(p.e50.at(-1)),e200=finite(p.e200.at(-1));
  return {asOf:frame.asOf,price:finite(frame.price),ema20:finite(p.e20.at(-1)),ema50:e50,ema200:e200,
    closeVsEma50:e50==null?null:frame.price-e50,closeVsEma200:e200==null?null:frame.price-e200,
    ema50VsEma200:e50==null||e200==null?null:e50-e200,eventTrend:s.trend,eventCount:s.events.length,
    lastEvent:s.events.at(-1)??null,confirmedHighPivotCount:p.piv.hi.filter(i=>i<=last-3).length,
    confirmedLowPivotCount:p.piv.lo.filter(i=>i<=last-3).length};
}

function contextBias(frame) {
  const e50=frame.prepared.e50.at(-1),e200=frame.prepared.e200.at(-1);
  if(frame.structure.trend>0&&Number.isFinite(e50)&&Number.isFinite(e200)&&e50>e200)return "Bullish";
  if(frame.structure.trend<0&&Number.isFinite(e50)&&Number.isFinite(e200)&&e50<e200)return "Bearish";
  return "Neutral";
}
function makeFrameSeries(frame) {
  return {...frame.prepared,t:frame.series.t,ct:frame.series.ct,o:frame.series.o,
    h:frame.series.h,l:frame.series.l,c:frame.series.c,v:frame.series.v};
}
export function buildCausalMultiTimeframeContext(input,options={}) {
  const evaluationTime=options.evaluationTime;
  if(!Number.isFinite(evaluationTime))throw new TypeError("evaluationTime must be a finite UTC millisecond timestamp");
  const keys=["weekly","daily","h4","h1"],frames={};
  for(const key of keys){
    const result=prepareClosedTimeframe(input?.[key],key,evaluationTime,options);
    if(result.status!=="PASS")return {status:"WAIT",reason:"TIMEFRAME_NOT_READY",timeframe:key,detail:result};
    frames[key]=result;
  }
  const {weekly,daily,h4,h1}=frames;
  const dailyRegime=buildRegimeTimeline(daily.prepared,options.regimeParameters);
  const raw=dailyRegime.raw.at(-1),effective=dailyRegime.eff.at(-1);
  const confirmBars=options.regimeParameters?.confirmBars??2;
  const rawTail=dailyRegime.raw.slice(-confirmBars);
  const regimeConfirmed=!!raw&&!!effective&&raw.reg===effective&&rawTail.length===confirmBars&&rawTail.every(item=>item?.reg===effective);
  const h4Series=makeFrameSeries(h4),h1Series=makeFrameSeries(h1);
  const lookback=Math.min(options.rangeLookback??50,h4.candles.length);
  const rangeHigh=Math.max(...h4.series.h.slice(-lookback)),rangeLow=Math.min(...h4.series.l.slice(-lookback));
  if(!Number.isFinite(h4.atr)||h4.atr<=0||!effective)return {status:"WAIT",reason:"INDICATOR_WARMUP_INCOMPLETE"};
  const liquidity=findLiquidityLevels(h4.prepared,h4.price,h4.atr,options.liquidityOptions);
  const context={
    weekly:{closed:true,asOf:weekly.asOf,trend:contextBias(weekly)},
    daily:{closed:true,asOf:daily.asOf,bias:contextBias(daily)},
    regime:{raw:raw?.reg??null,effective,confirmed:regimeConfirmed},
    h4:{closed:true,asOf:h4.asOf,series:h4Series,price:h4.price,close:h4.price,atr:h4.atr,
      trend:trendLabel(h4.structure.trend),rangeEquilibrium:(rangeHigh+rangeLow)/2,
      orderBlocks:findBullishOrderBlocks(h4.prepared,h4.structure.events,options.orderBlockLookback??150),
      fvgs:findBullishFvgs(h4.prepared,options.fvgLookback??80),
      targetLevels:liquidity.buySideLiquidity.map(level=>level.px),
      liquiditySweep:!!liquidity.sweep,rejection:h4.candles.at(-1).close>h4.candles.at(-1).open},
    h1:{closed:true,asOf:h1.asOf,series:h1Series}
  };
  const temporal=validateMultiTimeframeAsOf(context,{evaluationTime,maxAgeMs:options.maxAgeMs});
  if(temporal.status!=="PASS")return {status:"WAIT",reason:"TIMEFRAME_ASOF_VALIDATION_FAILED",temporal};
  return {status:"READY",evaluationTime,context,temporal,diagnostics:{weekly:frameEvidence(weekly),daily:frameEvidence(daily),dailyRegimeRaw:raw?.reg??null,dailyRegimeWhy:raw?.why??null,dailyRegimeFacts:raw?.facts??null},
  metadata:{
    intervals:{...CAUSAL_MTF_INTERVALS,...options.intervals},
    closedCandleCounts:Object.fromEntries(keys.map(key=>[key,frames[key].candles.length])),
    warnings:Object.fromEntries(keys.map(key=>[key,frames[key].warnings]))}};
}
export function evaluateCausalMultiTimeframeSetup(input,options={}) {
  const built=buildCausalMultiTimeframeContext(input,options);
  if(built.status!=="READY")return {status:"WAIT",candidate:false,reasons:[built.reason],contextBuild:built};
  const decision=evaluateMultiTimeframeSetup(built.context,{...options,requireAsOfValidation:true,evaluationTime:options.evaluationTime});
  return {...decision,contextBuild:{status:built.status,temporal:built.temporal,metadata:built.metadata}};
}
