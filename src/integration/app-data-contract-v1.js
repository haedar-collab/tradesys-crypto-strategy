import {runHistoricalMtfReplay} from "../backtest/historical-mtf-replay.js";
const FRAMES=["weekly","daily","h4","h1"];
export function validateStrategyDataContract(payload){
 const errors=[];
 if(!payload||typeof payload!=="object")return {status:"FAIL",errors:["payload must be an object"]};
 if(payload.schema_version!=="1.0.0")errors.push("unsupported schema_version");
 if(payload.venue?.exchange!=="BINANCE"||payload.venue?.market_type!=="SPOT")errors.push("venue must be BINANCE SPOT");
 if(!Array.isArray(payload.universe)||payload.universe.length!==1)errors.push("exactly one symbol is required per replay payload");
 const symbol=payload.universe?.[0]?.symbol;
 if(!symbol||!payload.market?.[symbol])errors.push("symbol market data is missing");
 const asOf=Date.parse(payload.as_of);
 if(!Number.isFinite(asOf))errors.push("as_of must be a valid ISO date-time");
 const evaluationTimes=payload.context?.evaluation_times_ms;
 if(!Array.isArray(evaluationTimes)||!evaluationTimes.length||evaluationTimes.some((t,i)=>!Number.isFinite(t)||(i>0&&t<=evaluationTimes[i-1])))errors.push("evaluation_times_ms must be finite and strictly increasing");
 else if(Number.isFinite(asOf)&&evaluationTimes.some(t=>t>asOf))errors.push("evaluation time cannot be later than contract as_of");
 for(const frame of FRAMES){const rows=payload.market?.[symbol]?.[frame];if(!Array.isArray(rows)||rows.length===0){errors.push(`missing timeframe ${frame}`);continue;}
 let previous=-Infinity;for(let i=0;i<rows.length;i++){const c=rows[i],vals=[c.openTime,c.closeTime,c.open,c.high,c.low,c.close,c.volume];if(!vals.every(Number.isFinite)||c.openTime<=previous||c.closeTime<c.openTime||c.high<Math.max(c.open,c.close,c.low)||c.low>Math.min(c.open,c.close,c.high)||c.closed!==true){errors.push(`invalid candle ${frame}[${i}]`);break;}previous=c.openTime;}}
 return {status:errors.length?"FAIL":"PASS",errors,symbol,evaluationTimes,asOf};
}
export function runStrategyContractReplay(payload,options={}){
 const validation=validateStrategyDataContract(payload);
 if(validation.status!=="PASS")return {status:"REJECTED",mode:"historical-research-only",validation};
 const market=payload.market[validation.symbol];
 // Correct replay signature: input, ordered evaluation timestamps, then options.
 const replay=runHistoricalMtfReplay(market,validation.evaluationTimes,options);
 return {status:replay.status,mode:replay.mode,schemaVersion:payload.schema_version,symbol:validation.symbol,asOf:payload.as_of,validation:{status:"PASS"},replay};
}
