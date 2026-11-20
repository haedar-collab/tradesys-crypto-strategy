import {buildCausalMultiTimeframeContext} from "../engine/causal-mtf.js";
import {evaluateMultiTimeframeSetup} from "../engine/multi-timeframe.js";

function increment(map,key){map[key]=(map[key]??0)+1;}
function frameEvidence(frame){
 const last=frame.candles.length-1, p=frame.prepared, s=frame.structure;
 const finite=x=>Number.isFinite(x)?x:null;
 return {asOf:frame.asOf,price:finite(frame.price),ema20:finite(p.e20.at(-1)),ema50:finite(p.e50.at(-1)),ema200:finite(p.e200.at(-1)),
  closeVsEma50:finite(p.e50.at(-1))==null?null:frame.price-p.e50.at(-1),
  closeVsEma200:finite(p.e200.at(-1))==null?null:frame.price-p.e200.at(-1),
  ema50VsEma200:finite(p.e50.at(-1))==null||finite(p.e200.at(-1))==null?null:p.e50.at(-1)-p.e200.at(-1),
  eventTrend:s.trend,eventCount:s.events.length,lastEvent:s.events.at(-1)??null,
  confirmedHighPivotCount:p.piv.hi.filter(i=>i<=last-3).length,
  confirmedLowPivotCount:p.piv.lo.filter(i=>i<=last-3).length,
  latestConfirmedHighIndex:p.piv.hi.filter(i=>i<=last-3).at(-1)??null,
  latestConfirmedLowIndex:p.piv.lo.filter(i=>i<=last-3).at(-1)??null};
}
/** Read-only as-of diagnostics; never changes strategy rules or emits orders. */
export function runSignalDiagnostics(input,evaluationTimes,options={}){
 if(!Array.isArray(evaluationTimes)||!evaluationTimes.length)throw new TypeError("evaluationTimes must be non-empty");
 let previous=-Infinity;
 const rows=[],gateCounts={},weeklyCounts={},dailyCounts={},regimeCounts={},rawRegimeCounts={},structureCounts={},warmupCounts={},regimeWhyCounts={};
 for(const evaluationTime of evaluationTimes){
  if(!Number.isFinite(evaluationTime)||evaluationTime<=previous)throw new RangeError("evaluationTimes must be strictly increasing");
  previous=evaluationTime;
  const built=buildCausalMultiTimeframeContext(input,{...options,evaluationTime,requireAsOfValidation:true});
  if(built.status!=="READY"){
   const reason=built.reason??built.detail?.reason??"CONTEXT_NOT_READY";increment(gateCounts,reason);increment(warmupCounts,built.timeframe??"unknown");
   rows.push({evaluationTime,status:"WAIT",gate:reason,contextReady:false});continue;
  }
  const c=built.context;
  const decision=evaluateMultiTimeframeSetup(c,{...options,requireAsOfValidation:true,evaluationTime});
  const gate=decision.reasons?.[0]??(decision.candidate?"BUY_CANDIDATE":"NO_BLOCK_REASON");
  increment(gateCounts,gate);increment(weeklyCounts,c.weekly.trend);increment(dailyCounts,c.daily.bias);
  increment(regimeCounts,c.regime.effective);increment(rawRegimeCounts,c.regime.raw??"unknown");
  increment(structureCounts,c.h4.trend);
  const dailyFrame=buildCausalMultiTimeframeContext(input,{...options,evaluationTime});
  const regimeReason=dailyFrame.context?.regime?.raw;
  const regimeWhy=regimeReason?.why??"unavailable";increment(regimeWhyCounts,regimeWhy);
  const evidence={weekly:frameEvidence(dailyFrame.frames?.weekly??{}),daily:frameEvidence(dailyFrame.frames?.daily??{})};
  rows.push({evaluationTime,status:decision.status,candidate:decision.candidate===true,gate,contextReady:true,
   weekly:c.weekly.trend,daily:c.daily.bias,weeklyAsOf:c.weekly.asOf,dailyAsOf:c.daily.asOf,
   regime:{raw:c.regime.raw,effective:c.regime.effective,confirmed:c.regime.confirmed,why:regimeWhy,
    facts:regimeReason?.facts??null},h4Structure:c.h4.trend});
 }
 const count=evaluationTimes.length;
 return {status:"COMPLETE",method:"as-of-upstream-gate-diagnostics-v2",evaluationCount:count,
  contextReadyCount:rows.filter(x=>x.contextReady).length,contextWaitCount:rows.filter(x=>!x.contextReady).length,
  candidateCount:rows.filter(x=>x.candidate).length,gateCounts,weeklyBiasCounts:weeklyCounts,
  dailyBiasCounts:dailyCounts,effectiveRegimeCounts:regimeCounts,rawRegimeCounts,
  h4StructureCounts:structureCounts,warmupWaitCounts:warmupCounts,regimeWhyCounts,rows,
  limitations:["First blocking gate only; later gates may also block","Raw event/EMA evidence is descriptive, not a strategy-rule change","No fills, fees, slippage, trade returns or portfolio simulation"]};
}
