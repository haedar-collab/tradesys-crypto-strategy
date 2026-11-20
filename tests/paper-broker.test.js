import test from "node:test";
import assert from "node:assert/strict";
import { createPaperBroker } from "../src/paper/paper-broker.js";

const ACCEPT={decision:"ACCEPT",eligibleForPaperTrading:true};
const ALLOW={allowed:true};
const quote=(timestamp,bid=99,ask=101)=>({timestamp,bid,ask});
function setup(){let clock=1_800_000_000_000;return {now:()=>clock,setNow:v=>clock=v,broker:createPaperBroker({initialCash:10_000,feeBps:10,slippageBps:5,maxQuoteAgeMs:5_000,now:()=>clock})};}

test("paper broker fills long-only spot buy and updates cash and inventory",()=>{
 const {now,broker}=setup(),order=broker.submitMarketOrder({clientOrderId:"order_buy_0001",symbol:"BTCUSDT",side:"BUY",quantity:1,quote:quote(now()),strategyAcceptance:ACCEPT,riskGate:ALLOW});
 assert.equal(order.status,"FILLED");assert.equal(order.mode,"PAPER_ONLY");assert.ok(order.fillPrice>101);
 const state=broker.snapshot();assert.equal(state.positions[0].quantity,1);assert.ok(state.cash<10_000);assert.equal(state.orders.length,1);
});

test("client order id is idempotent and does not double fill",()=>{
 const {now,broker}=setup(),input={clientOrderId:"order_buy_0002",symbol:"BTCUSDT",side:"BUY",quantity:1,quote:quote(now()),strategyAcceptance:ACCEPT,riskGate:ALLOW};
 const first=broker.submitMarketOrder(input),second=broker.submitMarketOrder(input);
 assert.deepEqual(first,second);assert.equal(broker.snapshot().orders.length,1);
});

test("paper sell realizes PnL and closes inventory",()=>{
 const {now,broker}=setup();
 broker.submitMarketOrder({clientOrderId:"order_buy_0003",symbol:"BTCUSDT",side:"BUY",quantity:1,quote:quote(now()),strategyAcceptance:ACCEPT,riskGate:ALLOW});
 const sell=broker.submitMarketOrder({clientOrderId:"order_sell_0003",symbol:"BTCUSDT",side:"SELL",quantity:1,quote:quote(now(),110,111),strategyAcceptance:ACCEPT,riskGate:ALLOW});
 assert.equal(sell.status,"FILLED");assert.ok(sell.realizedPnl>0);assert.equal(broker.snapshot().positions.length,0);
});

test("blocks missing strategy approval, risk approval and stale quotes",()=>{
 const {now,broker,setNow}=setup();
 assert.throws(()=>broker.submitMarketOrder({clientOrderId:"order_buy_0004",symbol:"BTCUSDT",side:"BUY",quantity:1,quote:quote(now()),strategyAcceptance:{decision:"CONDITIONAL"},riskGate:ALLOW}),/acceptance gate/);
 assert.throws(()=>broker.submitMarketOrder({clientOrderId:"order_buy_0005",symbol:"BTCUSDT",side:"BUY",quantity:1,quote:quote(now()),strategyAcceptance:ACCEPT,riskGate:{allowed:false}}),/risk gate/);
 setNow(now()+10_000);
 assert.throws(()=>broker.submitMarketOrder({clientOrderId:"order_buy_0006",symbol:"BTCUSDT",side:"BUY",quantity:1,quote:quote(now()-10_000),strategyAcceptance:ACCEPT,riskGate:ALLOW}),/stale/);
});

test("blocks future quotes, insufficient cash and overselling",()=>{
 const {now,broker}=setup();
 assert.throws(()=>broker.submitMarketOrder({clientOrderId:"order_buy_0007",symbol:"BTCUSDT",side:"BUY",quantity:1,quote:quote(now()+1),strategyAcceptance:ACCEPT,riskGate:ALLOW}),/stale or future/);
 assert.throws(()=>broker.submitMarketOrder({clientOrderId:"order_buy_0008",symbol:"BTCUSDT",side:"BUY",quantity:100,quote:quote(now()),strategyAcceptance:ACCEPT,riskGate:ALLOW}),/insufficient paper cash/);
 assert.throws(()=>broker.submitMarketOrder({clientOrderId:"order_sell_0008",symbol:"BTCUSDT",side:"SELL",quantity:1,quote:quote(now()),strategyAcceptance:ACCEPT,riskGate:ALLOW}),/insufficient paper position/);
});

test("mark to market values open positions using fresh bid prices",()=>{
 const {now,broker}=setup();
 broker.submitMarketOrder({clientOrderId:"order_buy_0009",symbol:"BTCUSDT",side:"BUY",quantity:1,quote:quote(now()),strategyAcceptance:ACCEPT,riskGate:ALLOW});
 const mark=broker.markToMarket({BTCUSDT:quote(now(),105,106)});
 assert.ok(mark.equity>0);assert.equal(mark.marks.length,1);assert.ok(mark.unrealizedPnl>0);
});
