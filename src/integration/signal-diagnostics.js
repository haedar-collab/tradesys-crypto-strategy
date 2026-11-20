import {buildCausalMultiTimeframeContext} from "../engine/causal-mtf.js";
import {evaluateMultiTimeframeSetup} from "../engine/multi-timeframe.js";

function bias(frame){
 const e50=frame.prepared.e50.at(-1),e200=frame.prepared.e200.at(-1);
 if(frame.structure.trend>0&&Number.isFinite(e50)&&Number.isFinite(e200)&&e50>e200)return "Bullish";
 if(frame.structure.trend<0&&Number.isFinite(e50)&&Number.isFinite(e200)&&e50<e200)return "Bearish";
 return "Neutral";
}
function increment(map,key){map[key]=(map[key]??0)+1;}
/**
 * Reports the exact upstream evidence and first blocking gate at each as-of time.
 * It never changes strategy rules and never creates or executes orders.
 */
export function runSignalDiagnostics(input,evaluationTimes,options={}){
 if(!Array.isArray(evaluationTimes)||!evaluationTimes.length)throw new TypeError("evaluationTimes must be non-empty");
 let previous=-Infinity;
 const rows=[],gateCounts={},weeklyCounts={},dailyCounts={},regimeCounts={},rawRegimeCounts={},structureCounts={},warmupCounts={};
 for(const evaluationTime of evaluationTimes){
  if(!Number.isFinite(evaluationTime)||evaluationTime<=previous)throw new RangeError("evaluationTimes must be strictly increasing");
  previous=evaluationTime;
  const built=buildCausalMultiTimeframeContext(input,{...options,evaluationTime,requireAsOfValidation:true});
  if(built.status!=="READY"){
   const reason=built.reason??built.detail?.reason??"CONTEXT_NOT_READY";
   increment(gateCounts,reason);increment(warmupCounts,built.timeframe??"unknown");
   rows.push({evaluationTime,status:"WAIT",gate:reason,contextReady:false});
   continue;
  }
  const c=built.context,weekly=c.weekly.trend,daily=c.daily.bias,regime=c.regime.effective;
  const decision=evaluateMultiTimeframeSetup(c,{...options,requireAsOfValidation:true,evaluationTime});
  const gate=decision.reasons?.[0]??(decision.candidate?"BUY_CANDIDATE":"NO_BLOCK_REASON");
  increment(gateCounts,gate);increment(weeklyCounts,weekly);increment(dailyCounts,daily);
  increment(regimeCounts,regime);increment(rawRegimeCounts,c.regime.raw??"unknown");
  increment(structureCounts,c.h4.trend);
  rows.push({evaluationTime,status:decision.status,candidate:decision.candidate===true,gate,contextReady:true,
   weekly,daily,weeklyAsOf:c.weekly.asOf,dailyAsOf:c.daily.asOf,
   regime:{raw:c.regime.raw,effective:regime,confirmed:c.regime.confirmed},
   h4Structure:c.h4.trend,price:c.daily.bias==="Bullish"?c.h4.price:undefined});
 }
 const count=evaluationTimes.length;
 return {status:"COMPLETE",method:"as-of-upstream-gate-diagnostics",evaluationCount:count,
  contextReadyCount:rows.filter(x=>x.contextReady).length,contextWaitCount:rows.filter(x=>!x.contextReady).length,
  candidateCount:rows.filter(x=>x.candidate).length,gateCounts,weeklyBiasCounts:weeklyCounts,
  dailyBiasCounts:dailyCounts,effectiveRegimeCounts:regimeCounts,rawRegimeCounts,
  h4StructureCounts:structureCounts,warmupWaitCounts:warmupCounts,
  rows,limitations:["Diagnostics report first blocking gate only; later gates may also block","No strategy thresholds or rules are modified","No fills, fees, slippage, trade returns or portfolio simulation"]};
}
