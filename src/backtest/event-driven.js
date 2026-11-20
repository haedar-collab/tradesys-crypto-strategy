/**
 * Single-symbol, long-only spot event-driven backtest.
 * Signals are evaluated at candle close and enter no earlier than next bar open.
 * Entry-bar OHLC is processed after the simulated open. Ambiguous exits are
 * conservative; fees and adverse slippage are charged on every executed tranche.
 * This is a deterministic research simulator, not an exchange fill model.
 */
import { advanceLongPosition } from "../risk/trade-plan.js";
import { markPosition } from "./mark-to-market.js";
import { evaluateDrawdownRisk } from "../risk/portfolio.js";

function validBars(bars) {
  if (!Array.isArray(bars) || bars.length < 2) throw new TypeError("at least two OHLC bars are required");
  for (let i=0;i<bars.length;i++) {
    const b=bars[i];
    if (!b || ![b.t,b.o,b.h,b.l,b.c].every(Number.isFinite) ||
      b.o<=0 || b.h<=0 || b.l<=0 || b.c<=0 ||
      b.h<Math.max(b.o,b.c,b.l) || b.l>Math.min(b.o,b.c,b.h) ||
      (i>0 && b.t<=bars[i-1].t)) throw new RangeError(`invalid or unordered OHLC bar at index ${i}`);
  }
}

function validateSignal(signal, barsLength) {
  return signal && Number.isInteger(signal.index) && signal.index>=0 && signal.index<barsLength-1 &&
    signal.plan && [signal.plan.entry,signal.plan.stop,signal.plan.tp1,signal.plan.tp2,signal.plan.tp3].every(Number.isFinite) &&
    signal.plan.stop>0 && signal.plan.entry>0 && signal.plan.tp1>0 && signal.plan.tp2>0 && signal.plan.tp3>0 &&
    signal.plan.stop<signal.plan.entry && signal.plan.entry<signal.plan.tp1 &&
    signal.plan.tp1<signal.plan.tp2 && signal.plan.tp2<signal.plan.tp3;
}

export function runEventBacktest(input) {
  if (!input) throw new TypeError("backtest input is required");
  const {bars,signals}=input;
  validBars(bars);
  if (!Array.isArray(signals) || signals.some(s=>!validateSignal(s,bars.length))) {
    throw new TypeError("signals must have a valid close index and ascending long trade plan");
  }
  const initialCapital=input.initialCapital??10000;
  const riskPct=input.riskPct??1;
  const feeBps=input.feeBps??10;
  const slippageBps=input.slippageBps??5;
  const minRR=input.minRR??1.5;
  const maxEntryDriftPct=input.maxEntryDriftPct??1;
  const ddLimitPct=input.ddLimitPct??10;
  const ddRecoverPct=input.ddRecoverPct??5;
  const ddReducedMultiplier=input.ddReducedMultiplier??0.5;
  if (![initialCapital,riskPct,feeBps,slippageBps,minRR,maxEntryDriftPct,ddLimitPct,ddRecoverPct,ddReducedMultiplier].every(Number.isFinite) ||
      initialCapital<=0 || riskPct<=0 || riskPct>100 || feeBps<0 || slippageBps<0 ||
      minRR<=0 || maxEntryDriftPct<0 || ddLimitPct<=0 || ddLimitPct>=100 || ddRecoverPct<0 || ddRecoverPct>=ddLimitPct || ddReducedMultiplier<=0 || ddReducedMultiplier>1) throw new RangeError("invalid backtest parameters");
  const feeRate=feeBps/10000, slipRate=slippageBps/10000;
  const byIndex=new Map();
  for (const signal of [...signals].sort((a,b)=>a.index-b.index)) {
    if(!byIndex.has(signal.index)) byIndex.set(signal.index,[]);
    byIndex.get(signal.index).push(signal);
  }

  let equity=initialCapital, peak=initialCapital, maxDrawdownPct=0, active=null, drawdownState="NORMAL";
  let drawdownGate=evaluateDrawdownRisk({equity,peakEquity:peak,ddLimitPct,ddRecoverPct,reducedMultiplier:ddReducedMultiplier,previousState:drawdownState});
  const refreshDrawdown=markedEquity=>{
    peak=Math.max(peak,markedEquity);
    const dd=(peak-markedEquity)/peak*100;
    maxDrawdownPct=Math.max(maxDrawdownPct,dd);
    drawdownGate=evaluateDrawdownRisk({equity:markedEquity,peakEquity:peak,ddLimitPct,ddRecoverPct,reducedMultiplier:ddReducedMultiplier,previousState:drawdownState});
    drawdownState=drawdownGate.state;
  };
  const trades=[], skipped=[];
  const processActiveBar=(index,bar)=>{
    if(!active) return;
    const update=advanceLongPosition(active.state,{low:bar.l,high:bar.h});
    if(update.status==="WAIT_DATA") throw new Error("exit state machine rejected validated position/bar");
    for(const exit of update.exits||[]) {
      const isStop=exit.reason.includes("STOP") || exit.reason.includes("BREAKEVEN");
      const rawFill=isStop && bar.o<exit.price ? bar.o : exit.price;
      const fill=rawFill*(1-slipRate);
      const qty=active.quantity*exit.fraction;
      const gross=(fill-active.entryFill)*qty;
      const fee=fill*qty*feeRate;
      active.grossPnl+=gross;
      active.exitFees+=fee;
      active.exitEvents.push({index,time:bar.t,reason:exit.reason,price:fill,quantity:qty,grossPnl:gross,fee});
    }
    active.state=update;
    if(update.status==="CLOSED") {
      const netPnl=active.grossPnl-active.entryFee-active.exitFees;
      equity+=netPnl;
      trades.push({
        signalIndex:active.signal.index,entryIndex:active.entryIndex,exitIndex:index,
        entryTime:active.entryTime,exitTime:bar.t,entry:active.entryFill,
        quantity:active.quantity,notional:active.notional,stop:active.signal.plan.stop,
        tp1:active.signal.plan.tp1,tp2:active.signal.plan.tp2,tp3:active.signal.plan.tp3,
        grossPnl:active.grossPnl,fees:active.entryFee+active.exitFees,netPnl,
        returnPct:netPnl/active.notional*100,exitEvents:active.exitEvents,status:"CLOSED"
      });
      active=null;
      peak=Math.max(peak,equity);
      maxDrawdownPct=Math.max(maxDrawdownPct,(peak-equity)/peak*100);
    }
  };

  for(let i=1;i<bars.length;i++) {
    const bar=bars[i];
    if(active) {
      const pending=byIndex.get(i-1)||[];
      for(const signal of pending) skipped.push({index:signal.index,reason:"POSITION_ALREADY_OPEN"});
      processActiveBar(i,bar);
      if(active) {
        const marked=markPosition({...active,remaining:active.state.remaining},bar.c,feeRate,slipRate);
        const markedEquity=equity+marked.netContribution;
        refreshDrawdown(markedEquity);
      } else {
        refreshDrawdown(equity);
      }
      continue;
    }

    const candidates=byIndex.get(i-1)||[];
    if(!candidates.length) continue;
    const signal=candidates[0], open=bar.o, plan=signal.plan;
    const entryFill=open*(1+slipRate);
    if(open>plan.entry*(1+maxEntryDriftPct/100)) {
      skipped.push({index:signal.index,reason:"ENTRY_GAP_EXCEEDS_MAX_DRIFT"});
      continue;
    }
    if(entryFill<=plan.stop || entryFill>=plan.tp1) {
      skipped.push({index:signal.index,reason:"ENTRY_OUTSIDE_VALID_PLAN"});
      continue;
    }
    const liveRR=(plan.tp2-entryFill)/(entryFill-plan.stop);
    if(liveRR<minRR) {
      skipped.push({index:signal.index,reason:"ENTRY_RR_BELOW_MINIMUM"});
      continue;
    }
    if(!drawdownGate.allowNewEntries) { skipped.push({index:signal.index,reason:"MARKED_DRAWDOWN_LIMIT_REACHED"}); continue; }
    const riskBudget=equity*riskPct/100*drawdownGate.multiplier;
    const stopPct=(entryFill-plan.stop)/entryFill;
    const notional=Math.min(equity/(1+feeRate),riskBudget/stopPct);
    if(notional<=0) {
      skipped.push({index:signal.index,reason:"NO_AVAILABLE_SPOT_CAPITAL"});
      continue;
    }
    const quantity=notional/entryFill, entryFee=notional*feeRate;
    active={
      signal,entryIndex:i,entryTime:bar.t,entryFill,notional,quantity,entryFee,
      grossPnl:0,exitFees:0,exitEvents:[],
      state:{entry:entryFill,stop:plan.stop,tp1:plan.tp1,tp2:plan.tp2,tp3:plan.tp3,stage:0,remaining:1,status:"OPEN"}
    };
    // The signal candle is never used for entry; the next bar is processed from
    // its open onward so a stop/target on the entry bar is not silently ignored.
    processActiveBar(i,bar);
    if(active) {
      const marked=markPosition({...active,remaining:active.state.remaining},bar.c,feeRate,slipRate);
      const markedEquity=equity+marked.netContribution;
      refreshDrawdown(markedEquity);
    } else {
      refreshDrawdown(equity);
    }
  }

  const openPosition=active?{
    signalIndex:active.signal.index,entryIndex:active.entryIndex,entry:active.entryFill,
    quantity:active.quantity,remaining:active.state.remaining,notional:active.notional,
    markPrice:bars[bars.length-1].c,
    unrealizedPnl:(bars[bars.length-1].c-active.entryFill)*active.quantity*active.state.remaining,
    status:"OPEN"
  }:null;
  const terminalMarked=equity+(active?markPosition({...active,remaining:active.state.remaining},bars.at(-1).c,feeRate,slipRate).netContribution:0);
  if(active) { peak=Math.max(peak,terminalMarked); maxDrawdownPct=Math.max(maxDrawdownPct,(peak-terminalMarked)/peak*100); }
  const netWins=trades.filter(t=>t.netPnl>0).reduce((s,t)=>s+t.netPnl,0);
  const netLosses=Math.abs(trades.filter(t=>t.netPnl<0).reduce((s,t)=>s+t.netPnl,0));
  const wins=trades.filter(t=>t.netPnl>0).length;
  return {
    status:"COMPLETE",
    initialCapital,realizedEndingEquity:equity,markedEndingEquity:terminalMarked,endingEquity:terminalMarked,
    netPnl:terminalMarked-initialCapital,
    netReturnPct:(terminalMarked/initialCapital-1)*100,
    tradeCount:trades.length,winRatePct:trades.length?wins/trades.length*100:0,
    profitFactor:netLosses?netWins/netLosses:null,
    maxDrawdownPct,maxDrawdownBasis:"marked equity at each closed-bar close, including estimated liquidation costs",trades,skipped,openPosition,
    assumptions:{entry:"next bar open after signal close",feeBps,slippageBps,
      sameBarAmbiguity:"stop-first; TP1 followed by same-bar breakeven touch exits remainder at breakeven",
      spotOnly:true,positionConcurrency:1,drawdownGuard:{limitPct:ddLimitPct,recoverPct:ddRecoverPct,reducedMultiplier:ddReducedMultiplier,state:drawdownState}}
  };
}
