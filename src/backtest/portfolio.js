/**
 * Aligned multi-symbol long-only Spot portfolio simulator.
 * All assets must share the same closed-bar timestamps. Signals execute no
 * earlier than the next bar open. Portfolio limits and return-correlation
 * checks are applied before every entry. No exchange or account I/O.
 */
import { advanceLongPosition } from "../risk/trade-plan.js";
import { calculateMarkedEquity } from "./mark-to-market.js";
import { calculatePositionSize, evaluatePortfolioRisk, evaluateDrawdownRisk } from "../risk/portfolio.js";

function validateBars(bars,symbol) {
  if(!Array.isArray(bars)||bars.length<2) throw new TypeError(`${symbol}: at least two bars required`);
  for(let i=0;i<bars.length;i++){
    const b=bars[i];
    if(!b||![b.t,b.o,b.h,b.l,b.c].every(Number.isFinite)||b.o<=0||b.h<=0||b.l<=0||b.c<=0||
      b.h<Math.max(b.o,b.c,b.l)||b.l>Math.min(b.o,b.c,b.h)||(i&&b.t<=bars[i-1].t))
      throw new RangeError(`${symbol}: invalid OHLC bar at ${i}`);
  }
}
function validSignal(s,n){
 return s&&Number.isInteger(s.index)&&s.index>=0&&s.index<n-1&&s.plan&&
  [s.plan.entry,s.plan.stop,s.plan.tp1,s.plan.tp2,s.plan.tp3].every(Number.isFinite)&&
  [s.plan.entry,s.plan.stop,s.plan.tp1,s.plan.tp2,s.plan.tp3].every(x=>x>0)&&
  s.plan.stop<s.plan.entry&&s.plan.entry<s.plan.tp1&&s.plan.tp1<s.plan.tp2&&s.plan.tp2<s.plan.tp3;
}

export function runPortfolioBacktest(input){
 if(!input||!input.assets||typeof input.assets!=="object") throw new TypeError("assets map is required");
 const symbols=Object.keys(input.assets).sort();
 if(!symbols.length) throw new TypeError("at least one asset is required");
 const first=input.assets[symbols[0]].bars;
 validateBars(first,symbols[0]);
 for(const symbol of symbols){
  const asset=input.assets[symbol];
  validateBars(asset.bars,symbol);
  if(asset.bars.length!==first.length||asset.bars.some((b,i)=>b.t!==first[i].t))
    throw new RangeError("all assets must have identical aligned timestamps");
  if(!Array.isArray(asset.signals)||asset.signals.some(s=>!validSignal(s,first.length)))
    throw new TypeError(`${symbol}: invalid signal or trade plan`);
 }
 const initialCapital=input.initialCapital??10000, riskPct=input.riskPct??1;
 const regimeCapPct=input.regimeCapPct??80, maxPositions=input.maxPositions??5;
 const corrMax=input.corrMax??0.8, feeRate=(input.feeBps??10)/10000, slipRate=(input.slippageBps??5)/10000;
 const minRR=input.minRR??1.5, maxEntryDriftPct=input.maxEntryDriftPct??1;
 const ddLimitPct=input.ddLimitPct??10, ddRecoverPct=input.ddRecoverPct??5, ddReducedMultiplier=input.ddReducedMultiplier??0.5;
 if(![initialCapital,riskPct,regimeCapPct,maxPositions,corrMax,feeRate,slipRate,minRR,maxEntryDriftPct].every(Number.isFinite)||
   initialCapital<=0||riskPct<=0||riskPct>100||regimeCapPct<0||regimeCapPct>100||
   !Number.isInteger(maxPositions)||maxPositions<1||corrMax< -1||corrMax>1||feeRate<0||slipRate<0||minRR<=0||maxEntryDriftPct<0||
   !Number.isFinite(ddLimitPct)||!Number.isFinite(ddRecoverPct)||!Number.isFinite(ddReducedMultiplier))
   throw new RangeError("invalid portfolio backtest parameters");

 const signalMap=new Map();
 for(const symbol of symbols){
  for(const s of input.assets[symbol].signals){
   const key=s.index;
   if(!signalMap.has(key)) signalMap.set(key,[]);
   signalMap.get(key).push({symbol,signal:s});
  }
 }
 let equity=initialCapital,peak=initialCapital,maxDrawdownPct=0,drawdownState="NORMAL";
 const active=new Map(),trades=[],skipped=[];
 const closeOrAdvance=(symbol,index,bar)=>{
  const p=active.get(symbol); if(!p)return;
  const next=advanceLongPosition(p.state,{low:bar.l,high:bar.h});
  for(const exit of next.exits||[]){
   const stopExit=exit.reason.includes("STOP")||exit.reason.includes("BREAKEVEN");
   const raw=stopExit&&bar.o<exit.price?bar.o:exit.price;
   const fill=raw*(1-slipRate),qty=p.quantity*exit.fraction;
   const gross=(fill-p.entryFill)*qty,fee=fill*qty*feeRate;
   p.grossPnl+=gross;p.exitFees+=fee;
   p.exitEvents.push({index,time:bar.t,reason:exit.reason,price:fill,quantity:qty,grossPnl:gross,fee});
  }
  p.state=next;
  if(next.status==="CLOSED"){
   const netPnl=p.grossPnl-p.entryFee-p.exitFees; equity+=netPnl;
   trades.push({symbol,signalIndex:p.signal.index,entryIndex:p.entryIndex,exitIndex:index,
    entry:p.entryFill,quantity:p.quantity,notional:p.notional,grossPnl:p.grossPnl,
    fees:p.entryFee+p.exitFees,netPnl,returnPct:netPnl/p.notional*100,
    exitEvents:p.exitEvents,status:"CLOSED"});
   active.delete(symbol);peak=Math.max(peak,equity);
   maxDrawdownPct=Math.max(maxDrawdownPct,(peak-equity)/peak*100);
  }
 };
 let markedEquity=initialCapital;
 for(let i=1;i<first.length;i++){
  const activeAtStart=new Set(active.keys());
  for(const symbol of activeAtStart) closeOrAdvance(symbol,i,input.assets[symbol].bars[i]);
  const markedPositions=[...active.entries()].map(([symbol,p])=>({
   symbol,entryFill:p.entryFill,quantity:p.quantity,remaining:p.state.remaining,
   entryFee:p.entryFee,grossPnl:p.grossPnl,exitFees:p.exitFees
  }));
  const marks=Object.fromEntries(symbols.map(symbol=>[symbol,input.assets[symbol].bars[i].c]));
  markedEquity=calculateMarkedEquity(equity,markedPositions,marks,feeRate,slipRate).equity;
  peak=Math.max(peak,markedEquity);
  const barDrawdownPct=(peak-markedEquity)/peak*100;
  maxDrawdownPct=Math.max(maxDrawdownPct,barDrawdownPct);
  const candidates=(signalMap.get(i-1)||[]).sort((a,b)=>(b.signal.priority??0)-(a.signal.priority??0)||a.symbol.localeCompare(b.symbol));
  for(const {symbol,signal} of candidates){
   if(activeAtStart.has(symbol)||active.has(symbol)){
    skipped.push({symbol,index:signal.index,reason:"SYMBOL_ALREADY_ACTIVE"});continue;
   }
   const bar=input.assets[symbol].bars[i],plan=signal.plan,open=bar.o,entryFill=open*(1+slipRate);
   if(open>plan.entry*(1+maxEntryDriftPct/100)){
    skipped.push({symbol,index:signal.index,reason:"ENTRY_GAP_EXCEEDS_MAX_DRIFT"});continue;
   }
   if(entryFill<=plan.stop||entryFill>=plan.tp1||(plan.tp2-entryFill)/(entryFill-plan.stop)<minRR){
    skipped.push({symbol,index:signal.index,reason:"ENTRY_OUTSIDE_VALID_PLAN_OR_RR"});continue;
   }
   const openPositions=[...active.entries()].map(([sym,p])=>({
    symbol:sym,size:p.notional*p.state.remaining,dailyReturns:input.assets[sym].dailyReturns
   }));
   const ddGate=evaluateDrawdownRisk({equity:markedEquity,peakEquity:peak,ddLimitPct,ddRecoverPct,reducedMultiplier:ddReducedMultiplier,previousState:drawdownState});
   drawdownState=ddGate.state;
   if(!ddGate.allowNewEntries){skipped.push({symbol,index:signal.index,reason:"DRAWDOWN_LIMIT_REACHED"});continue;}
   const riskGate=evaluatePortfolioRisk({
    equity:markedEquity,regimeCapPct,maxPositions,candidateSymbol:symbol,openPositions,
    candidateReturns:input.assets[symbol].dailyReturns,corrMax
   });
   if(!riskGate.allowed){
    skipped.push({symbol,index:signal.index,reason:riskGate.reasons.join("|")});continue;
   }
   const sizing=calculatePositionSize({
    equity:markedEquity,riskPct,entry:entryFill,stop:plan.stop,availableExposure:riskGate.freeUsd,
    regimeMultiplier:signal.regimeMultiplier??1,
    drawdownMultiplier:(signal.drawdownMultiplier??1)*ddGate.multiplier,
    eventMultiplier:signal.eventMultiplier??1
   });
   if(sizing.status!=="SIZED"){
    skipped.push({symbol,index:signal.index,reason:sizing.reasons.join("|")});continue;
   }
   const notional=Math.min(sizing.size,markedEquity/(1+feeRate));
   const quantity=notional/entryFill,entryFee=notional*feeRate;
   active.set(symbol,{
    signal,entryIndex:i,entryFill,notional,quantity,entryFee,grossPnl:0,exitFees:0,exitEvents:[],
    state:{entry:entryFill,stop:plan.stop,tp1:plan.tp1,tp2:plan.tp2,tp3:plan.tp3,stage:0,remaining:1,status:"OPEN"}
   });
   closeOrAdvance(symbol,i,bar);
  }
 }
 const openPositions=[...active.entries()].map(([symbol,p])=>({
  symbol,entry:p.entryFill,quantity:p.quantity,remaining:p.state.remaining,notional:p.notional,
  markPrice:input.assets[symbol].bars.at(-1).c,
  unrealizedPnl:(input.assets[symbol].bars.at(-1).c-p.entryFill)*p.quantity*p.state.remaining
 }));
 const finalPositions=[...active.entries()].map(([symbol,p])=>({
  symbol,entryFill:p.entryFill,quantity:p.quantity,remaining:p.state.remaining,
  entryFee:p.entryFee,grossPnl:p.grossPnl,exitFees:p.exitFees
 }));
 const finalMarks=Object.fromEntries(symbols.map(symbol=>[symbol,input.assets[symbol].bars.at(-1).c]));
 const finalMarked=calculateMarkedEquity(equity,finalPositions,finalMarks,feeRate,slipRate);
 const wins=trades.filter(t=>t.netPnl>0),losses=trades.filter(t=>t.netPnl<0);
 const netWins=wins.reduce((s,t)=>s+t.netPnl,0),netLosses=Math.abs(losses.reduce((s,t)=>s+t.netPnl,0));
 return {
  status:"COMPLETE",initialCapital,realizedEndingEquity:equity,endingEquity:finalMarked.equity,markedEndingEquity:finalMarked.equity,netPnl:finalMarked.equity-initialCapital,
  netReturnPct:(finalMarked.equity/initialCapital-1)*100,tradeCount:trades.length,
  winRatePct:trades.length?wins.length/trades.length*100:0,
  profitFactor:netLosses?netWins/netLosses:null,maxDrawdownPct,
  maxDrawdownBasis:"marked equity at each aligned closed-bar close, including estimated liquidation costs",
  trades,skipped,openPositions,
  assumptions:{signal:"bar close",entry:"next bar open; entry bar is processed",
   feesAndSlippage:"applied on entry and each exit tranche",sameBarAmbiguity:"conservative stop-first",
   drawdownGuard:{limitPct:ddLimitPct,recoverPct:ddRecoverPct,reducedMultiplier:ddReducedMultiplier,state:drawdownState},
   spotOnly:true,maxConcurrentPositions:maxPositions,regimeExposureCapPct:regimeCapPct,corrMax}
 };
}
