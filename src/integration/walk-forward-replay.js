import {runStrategyContractReplay,validateStrategyDataContract} from "./app-data-contract-v1.js";

const HOUR=3_600_000;
/**
 * Build a chronological hourly evaluation schedule from already-closed H1 candles.
 * Each decision is timestamped one millisecond after the H1 close.
 */
export function buildWalkForwardEvaluationTimes(payload,{lookbackHours=168,stepHours=1,warmupBars=60}={}){
 if(!Number.isInteger(lookbackHours)||lookbackHours<1)throw new RangeError("lookbackHours must be a positive integer");
 if(!Number.isInteger(stepHours)||stepHours<1)throw new RangeError("stepHours must be a positive integer");
 if(!Number.isInteger(warmupBars)||warmupBars<60)throw new RangeError("warmupBars must be an integer >= 60");
 const base=validateStrategyDataContract({...payload,context:{...payload?.context,evaluation_times_ms:[payload?.context?.evaluation_times_ms?.[0]??Date.now()]}});
 if(base.status!=="PASS")throw new TypeError("Invalid strategy data contract: "+base.errors.join("; "));
 const rows=payload.market[base.symbol].h1;
 const closed=rows.filter(c=>c.closed===true).sort((a,b)=>a.closeTime-b.closeTime);
 const start=Math.max(warmupBars-1,closed.length-lookbackHours);
 const times=[];
 for(let i=start;i<closed.length;i+=stepHours){const t=closed[i].closeTime+1;if(t<=base.asOf)times.push(t);}
 if(!times.length)throw new RangeError("Insufficient closed H1 candles for walk-forward evaluation");
 return times;
}
export function runWalkForwardContractReplay(payload,options={}){
 const {lookbackHours=168,stepHours=1,warmupBars=60,replayOptions={},...scheduleOptions}=options;
 const evaluationTimes=buildWalkForwardEvaluationTimes(payload,{lookbackHours,stepHours,warmupBars,...scheduleOptions});
 const replay=runStrategyContractReplay({...payload,context:{...payload.context,evaluation_times_ms:evaluationTimes}},replayOptions);
 if(replay.status!=="COMPLETE")return replay;
 const reasonCounts={};
 for(const item of replay.replay.decisions)for(const reason of item.reasons)reasonCounts[reason]=(reasonCounts[reason]??0)+1;
 return {...replay,walkForward:{method:"rolling-hourly-as-of-replay",lookbackHours,stepHours,evaluationCount:evaluationTimes.length,firstEvaluation: new Date(evaluationTimes[0]).toISOString(),lastEvaluation:new Date(evaluationTimes.at(-1)).toISOString(),readyCount:replay.replay.readyCount,waitCount:replay.replay.evaluationCount-replay.replay.readyCount,candidateCount:replay.replay.candidateCount,reasonCounts,limitations:["Decision replay only; no position lifecycle or trade fills","No fee, slippage, spread or market-impact model","This is not a parameter-optimized out-of-sample performance report"]}};
}
