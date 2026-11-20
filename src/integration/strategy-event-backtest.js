import {runHistoricalMtfReplay} from "../backtest/historical-mtf-replay.js";
import {runEventBacktest} from "../backtest/event-driven.js";

/** Map replay candidates to the exact H1 candle that closed before the decision. */
export function mapReplayCandidatesToSignals(h1Candles,decisions){
 if(!Array.isArray(h1Candles)||!Array.isArray(decisions))throw new TypeError("H1 candles and replay decisions must be arrays");
 const byEvaluation=new Map();
 for(let i=0;i<h1Candles.length;i++){
  const candle=h1Candles[i];
  if(!candle||!Number.isFinite(candle.closeTime))throw new TypeError(`invalid H1 candle at index ${i}`);
  byEvaluation.set(candle.closeTime+1,i);
 }
 const signals=[],unmapped=[];
 for(const item of decisions){
  if(item.candidate!==true)continue;
  const index=byEvaluation.get(item.evaluationTime);
  const plan=item.decision?.plan;
  if(!Number.isInteger(index)||index>=h1Candles.length-1){unmapped.push({evaluationTime:item.evaluationTime,reason:"NO_NEXT_H1_BAR"});continue;}
  if(!plan||![plan.entry,plan.stop,plan.tp1,plan.tp2,plan.tp3].every(Number.isFinite)){
   unmapped.push({evaluationTime:item.evaluationTime,reason:"CANDIDATE_PLAN_MISSING_OR_INVALID"});continue;
  }
  signals.push({index,plan,priority:item.decision.priority??0});
 }
 return {signals,unmapped};
}

/**
 * End-to-end historical strategy replay -> H1 execution simulator.
 * Entry is always next H1 bar open; no exchange orders or live account I/O.
 */
export function runStrategyEventBacktest(timeframes,evaluationTimes,options={}){
 if(!timeframes?.h1||!Array.isArray(timeframes.h1))throw new TypeError("H1 timeframe candles are required");
 const {replayOptions={},backtestOptions={},...scheduleOptions}=options;
 const replay=runHistoricalMtfReplay(timeframes,evaluationTimes,replayOptions);
 const mapped=mapReplayCandidatesToSignals(timeframes.h1,replay.decisions);
 const bars=timeframes.h1.map(c=>({t:c.openTime,o:c.open,h:c.high,l:c.low,c:c.close}));
 const backtest=runEventBacktest({bars,signals:mapped.signals,...backtestOptions});
 return {status:"COMPLETE",mode:"historical-strategy-event-backtest",symbol:options.symbol??null,
  replay:{evaluationCount:replay.evaluationCount,candidateCount:replay.candidateCount},
  signalMapping:{executableSignalCount:mapped.signals.length,unmapped:mapped.unmapped},
  backtest,assumptions:{signalInformationSet:"closed MTF candles strictly before evaluation timestamp",
   entry:"next available H1 bar open after signal candle close",execution:"deterministic OHLC event simulator with configurable fee and adverse slippage",
   scope:"single symbol, long-only Binance Spot, one concurrent position",noLiveOrders:true}};
}
