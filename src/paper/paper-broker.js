/**
 * Deterministic in-memory Binance Spot-style paper broker.
 * This module never connects to an exchange, holds credentials, or submits live orders.
 */
function positive(value){return Number.isFinite(value)&&value>0;}
function clone(value){return structuredClone(value);}
function freeze(value){return Object.freeze(value);}
function validateSymbol(symbol){if(typeof symbol!=="string"||!/^[A-Z0-9]{2,20}$/.test(symbol))throw new TypeError("symbol is invalid");}
function validateId(id){if(typeof id!=="string"||!/^[A-Za-z0-9_-]{8,64}$/.test(id))throw new TypeError("clientOrderId must be 8-64 safe characters");}

export function createPaperBroker({
 initialCash=10_000, feeBps=10, slippageBps=5,
 maxQuoteAgeMs=5_000, now=()=>Date.now()
}={}){
 if(!positive(initialCash))throw new RangeError("initialCash must be positive");
 if(!Number.isFinite(feeBps)||feeBps<0||feeBps>1_000)throw new RangeError("feeBps is invalid");
 if(!Number.isFinite(slippageBps)||slippageBps<0||slippageBps>1_000)throw new RangeError("slippageBps is invalid");
 if(!Number.isSafeInteger(maxQuoteAgeMs)||maxQuoteAgeMs<0)throw new RangeError("maxQuoteAgeMs is invalid");
 if(typeof now!=="function")throw new TypeError("now must be a function");

 let cash=initialCash, sequence=0;
 const positions=new Map(), orders=new Map(), events=[];
 const emit=(type,payload)=>events.push(freeze({sequence:++sequence,type,at:now(),...clone(payload)}));
 function snapshot(){
  return freeze({cash,initialCash,positions:freeze([...positions.entries()].map(([symbol,p])=>freeze({symbol,...p}))),
   orders:freeze([...orders.values()].map(x=>freeze(clone(x)))),events:freeze(events.map(clone)),
   feesPaid:events.filter(e=>e.type==="ORDER_FILLED").reduce((s,e)=>s+e.fee,0)});
 }
 function validateQuote(symbol,quote){
  if(!quote||!Number.isSafeInteger(quote.timestamp)||!positive(quote.bid)||!positive(quote.ask)||quote.ask<quote.bid)
   throw new TypeError("a valid bid/ask quote with UTC millisecond timestamp is required");
  const current=now();
  if(!Number.isFinite(current)||quote.timestamp>current||current-quote.timestamp>maxQuoteAgeMs)
   throw new RangeError("quote is stale or from the future");
 }
 function submitMarketOrder(input){
  if(!input||typeof input!=="object")throw new TypeError("order input is required");
  const {clientOrderId,symbol,side,quantity,quote,strategyAcceptance,riskGate}=input;
  validateId(clientOrderId);validateSymbol(symbol);
  if(orders.has(clientOrderId))return freeze(clone(orders.get(clientOrderId)));
  if(side!=="BUY"&&side!=="SELL")throw new RangeError("only BUY and SELL spot orders are supported");
  if(!positive(quantity))throw new RangeError("quantity must be positive");
  if(strategyAcceptance?.decision!=="ACCEPT"||strategyAcceptance?.eligibleForPaperTrading!==true)
   throw new Error("strategy acceptance gate did not authorize paper trading");
  if(riskGate?.allowed!==true)throw new Error("portfolio risk gate did not authorize this order");
  validateQuote(symbol,quote);

  const slip=slippageBps/10_000;
  const reference=side==="BUY"?quote.ask:quote.bid;
  const fillPrice=side==="BUY"?reference*(1+slip):reference*(1-slip);
  const gross=quantity*fillPrice, fee=gross*feeBps/10_000;
  if(!Number.isFinite(gross)||!Number.isFinite(fee))throw new RangeError("order notional overflow");
  let realizedPnl=0;
  if(side==="BUY"){
   const total=gross+fee;
   if(total>cash+1e-9)throw new Error("insufficient paper cash");
   const prior=positions.get(symbol)??{quantity:0,averageCost:0};
   const nextQty=prior.quantity+quantity;
   const nextAvg=(prior.quantity*prior.averageCost+total)/nextQty;
   cash-=total;
   positions.set(symbol,{quantity:nextQty,averageCost:nextAvg});
  }else{
   const prior=positions.get(symbol);
   if(!prior||quantity>prior.quantity+1e-9)throw new Error("insufficient paper position quantity");
   realizedPnl=gross-fee-quantity*prior.averageCost;
   cash+=gross-fee;
   const remaining=Math.max(0,prior.quantity-quantity);
   if(remaining<=1e-9)positions.delete(symbol);
   else positions.set(symbol,{quantity:remaining,averageCost:prior.averageCost});
  }
  const order=freeze({clientOrderId,symbol,side,quantity,referencePrice:reference,fillPrice,
   gross,fee,realizedPnl,status:"FILLED",filledAt:now(),quoteTimestamp:quote.timestamp,
   executionModel:"TOP_OF_BOOK_PLUS_FIXED_SLIPPAGE",mode:"PAPER_ONLY"});
  orders.set(clientOrderId,order);
  emit("ORDER_FILLED",order);
  return order;
 }
 function markToMarket(quotes){
  if(!quotes||typeof quotes!=="object")throw new TypeError("quotes map is required");
  let marketValue=0;
  const marks=[];
  for(const [symbol,p] of positions){
   const quote=quotes[symbol];validateQuote(symbol,quote);
   const value=p.quantity*quote.bid;
   marketValue+=value;marks.push({symbol,quantity:p.quantity,markPrice:quote.bid,marketValue:value});
  }
  return freeze({cash,marketValue,equity:cash+marketValue,unrealizedPnl:marks.reduce((s,m)=>{
   const p=positions.get(m.symbol);return s+m.quantity*(m.markPrice-p.averageCost);
  },0),marks:freeze(marks)});
 }
 return freeze({submitMarketOrder,markToMarket,snapshot});
}
