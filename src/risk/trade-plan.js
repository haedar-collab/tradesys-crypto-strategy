/**
 * Deterministic long-only spot trade-plan builder and bar-by-bar exit state machine.
 * OHLC bars must be closed. If stop and target are both touched in one bar,
 * the stop is evaluated first (conservative ambiguity policy).
 */
export function buildLongPlan(input, options = {}) {
  if (!input || !input.zone || ![input.zone.lo,input.zone.hi,input.atr].every(Number.isFinite) ||
      input.zone.lo<=0 || input.zone.hi<=input.zone.lo || input.atr<=0 || !Number.isFinite(input.price) || input.price<=0 || (input.targetLevels!=null && !Array.isArray(input.targetLevels))) {
    return {status:"WAIT_DATA",reasons:["INVALID_ZONE_OR_ATR"]};
  }
  const stopAtr=options.stopAtr??1, atrMin=options.atrMin??0.5, atrMax=options.atrMax??3;
  const minRR=options.minRR??1.5;
  if (![stopAtr,atrMin,atrMax,minRR].every(Number.isFinite)||stopAtr<0||atrMin<=0||atrMax<atrMin||minRR<=0) {
    return {status:"BLOCKED",reasons:["INVALID_PLAN_PARAMETERS"]};
  }
  const entry=(input.zone.lo+input.zone.hi)/2;
  let stop=input.zone.lo-stopAtr*input.atr;
  if(entry-stop<atrMin*input.atr) stop=entry-atrMin*input.atr;
  if(entry-stop>atrMax*input.atr) stop=entry-atrMax*input.atr;
  const risk=entry-stop;
  const levels=[...(input.targetLevels||[])].filter(Number.isFinite).filter(x=>x>input.price && x>=entry+0.8*risk).sort((a,b)=>a-b);
  const tp1=levels[0]??entry+1.5*risk;
  const tp2=levels.find(x=>x>=tp1+0.5*risk)??tp1+Math.max(risk,tp1-entry);
  const tp3=levels.find(x=>x>=tp2+0.5*risk)??tp2+Math.max(risk,0.6*(tp2-entry));
  const rr=(tp2-entry)/risk;
  if(rr<minRR) return {status:"WAIT",reasons:["PLANNED_RR_BELOW_MINIMUM"],entry,stop,tp1,tp2,tp3,rr};
  return {status:"READY",entry,stop,tp1,tp2,tp3,risk,rr,
    scaleOut:{tp1:0.4,tp2:0.4,tp3:0.2},
    invalidation:{type:"CLOSED_4H_CLOSE_BELOW_ZONE_LOW",price:input.zone.lo}};
}

export function advanceLongPosition(position, bar) {
  if(!position||!bar||![position.stop,position.entry,position.tp1,position.tp2,position.tp3,bar.high,bar.low].every(Number.isFinite)||
    bar.low>bar.high||position.stop>=position.entry) {
    return {status:"WAIT_DATA",reasons:["INVALID_POSITION_OR_BAR"]};
  }
  if(position.status==="CLOSED") return {...position,exits:[]};
  let stage=position.stage??0, remaining=position.remaining??1, stop=position.stop;
  const exits=[];
  const take=(fraction,price,reason)=>{
    const qty=Math.min(remaining,fraction);
    if(qty>0){exits.push({fraction:qty,price,reason});remaining-=qty;}
  };
  // Conservative OHLC ambiguity rule: test active stop before targets.
  if(bar.low<=stop){
    take(remaining,stop,stage===0?"STOP_LOSS":"BREAKEVEN_OR_TRAILING_STOP");
    return {...position,stage,remaining,stop,status:"CLOSED",exits};
  }
  if(stage===0&&bar.high>=position.tp1){
    take(0.4,position.tp1,"TP1");
    stage=1;stop=position.entry;
    // If the same OHLC bar also trades through the newly activated breakeven,
    // assume TP1 happened first and conservatively exit the remaining size.
    if(bar.low<=stop){
      take(remaining,stop,"BREAKEVEN_SAME_BAR");
      return {...position,stage,remaining:0,stop,status:"CLOSED",exits};
    }
  }
  if(stage===1&&bar.high>=position.tp2){
    take(0.4,position.tp2,"TP2");
    stage=2;
  }
  if(stage===2&&bar.high>=position.tp3){
    take(remaining,position.tp3,"TP3");
    stage=3;
  }
  const status=remaining<=1e-9?"CLOSED":"OPEN";
  return {...position,stage,remaining:Math.max(0,remaining),stop,status,exits};
}
