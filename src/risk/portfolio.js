/**
 * Pure long-only spot position sizing and portfolio exposure gates.
 * No account API, exchange API, persistence, or order execution.
 */
function finitePositive(value) { return Number.isFinite(value) && value > 0; }

export function calculatePositionSize(input) {
  const required = ["equity", "riskPct", "entry", "stop"];
  if (!input || required.some(key => !Number.isFinite(input[key]))) {
    return { status:"WAIT_DATA", size:0, riskUsd:0, reasons:["INVALID_OR_MISSING_INPUT"] };
  }
  const { equity, riskPct, entry, stop } = input;
  const regimeMultiplier = input.regimeMultiplier ?? 1;
  const drawdownMultiplier = input.drawdownMultiplier ?? 1;
  const eventMultiplier = input.eventMultiplier ?? 1;
  if (!finitePositive(equity) || !finitePositive(entry) || !finitePositive(riskPct) ||
      stop <= 0 || stop >= entry ||
      ![regimeMultiplier,drawdownMultiplier,eventMultiplier].every(x=>Number.isFinite(x)&&x>=0)) {
    return { status:"BLOCKED",size:0,riskUsd:0,reasons:["INVALID_RISK_PARAMETERS"] };
  }
  const stopDistancePct = (entry-stop)/entry;
  const multiplier = regimeMultiplier*drawdownMultiplier*eventMultiplier;
  const requestedRiskUsd = equity*(riskPct/100)*multiplier;
  const uncappedSize = requestedRiskUsd/stopDistancePct;
  const availableExposure = input.availableExposure == null ? Infinity : input.availableExposure;
  if (!(availableExposure >= 0)) return {status:"BLOCKED",size:0,riskUsd:0,reasons:["INVALID_AVAILABLE_EXPOSURE"]};
  const size = Math.min(uncappedSize,availableExposure);
  const riskUsd = size*stopDistancePct;
  const reasons=[];
  if (drawdownMultiplier<1) reasons.push("DRAWDOWN_SIZE_REDUCTION");
  if (eventMultiplier<1) reasons.push("EVENT_RISK_SIZE_REDUCTION");
  if (regimeMultiplier<1) reasons.push("REGIME_SIZE_REDUCTION");
  if (size<uncappedSize) reasons.push("CAPPED_BY_AVAILABLE_EXPOSURE");
  if (size<=0) reasons.push("NO_AVAILABLE_EXPOSURE");
  return {
    status:size>0?"SIZED":"BLOCKED",
    size,riskUsd,sizePct:100*size/equity,
    requestedRiskUsd,stopDistancePct,multiplier,
    uncappedSize,availableExposure,
    reasons
  };
}

export function pearsonCorrelation(a,b) {
  if (!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length||a.length<2) return null;
  if (![...a,...b].every(Number.isFinite)) return null;
  const ma=a.reduce((s,x)=>s+x,0)/a.length, mb=b.reduce((s,x)=>s+x,0)/b.length;
  let cov=0,va=0,vb=0;
  for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;cov+=x*y;va+=x*x;vb+=y*y;}
  return va>0&&vb>0?cov/Math.sqrt(va*vb):null;
}

export function evaluatePortfolioRisk(input) {
  const required=["equity","regimeCapPct","maxPositions","candidateSymbol"];
  if(!input||required.some(k=>input[k]==null)) return {status:"WAIT_DATA",allowed:false,reasons:["MISSING_PORTFOLIO_CONTEXT"]};
  const {equity,regimeCapPct,maxPositions,candidateSymbol}=input;
  if(!finitePositive(equity)||!Number.isFinite(regimeCapPct)||regimeCapPct<0||regimeCapPct>100||
    !Number.isInteger(maxPositions)||maxPositions<1||typeof candidateSymbol!=="string"||!candidateSymbol) {
    return {status:"BLOCKED",allowed:false,reasons:["INVALID_PORTFOLIO_PARAMETERS"]};
  }
  const open=input.openPositions||[], pending=input.pendingSignals||[], newSignals=input.newSignals||[];
  const active=[...open,...pending,...newSignals];
  const usedUsd=active.reduce((sum,x)=>sum+(Number.isFinite(x.size)?Math.max(0,x.size):0),0);
  const capUsd=equity*regimeCapPct/100, freeUsd=Math.max(0,capUsd-usedUsd);
  const slots=Math.max(0,maxPositions-active.length);
  const reasons=[];
  if(active.some(x=>x.symbol===candidateSymbol)) reasons.push("SYMBOL_ALREADY_ACTIVE");
  if(slots<=0) reasons.push("MAX_POSITIONS_REACHED");
  if(freeUsd<=0) reasons.push("REGIME_EXPOSURE_CAP_REACHED");
  const candidateReturns=input.candidateReturns;
  const corrMax=input.corrMax??0.8;
  if(!Number.isFinite(corrMax)||corrMax< -1||corrMax>1) return {status:"BLOCKED",allowed:false,reasons:["INVALID_CORRELATION_THRESHOLD"]};
  let correlatedWith=null, highestCorrelation=null;
  if(active.some(item=>item.symbol===candidateSymbol)){correlatedWith=candidateSymbol;highestCorrelation=1;}
  if(Array.isArray(candidateReturns) && !correlatedWith) {
    for(const item of active) {
      const corr=pearsonCorrelation(candidateReturns,item.dailyReturns);
      if(corr!=null&&(highestCorrelation==null||corr>highestCorrelation)) highestCorrelation=corr;
      if(corr!=null&&corr>corrMax){correlatedWith=item.symbol;break;}
    }
  }
  if(correlatedWith) reasons.push("CORRELATED_WITH_ACTIVE_POSITION");
  return {
    status:reasons.length?"BLOCKED":"ALLOWED",
    allowed:reasons.length===0,reasons,capUsd,usedUsd,freeUsd,slots,
    activeCount:active.length,correlatedWith,highestCorrelation
  };
}
