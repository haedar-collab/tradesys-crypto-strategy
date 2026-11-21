import test from "node:test";
import assert from "node:assert/strict";
import { createPaperDashboardRuntimeSnapshot } from "../src/paper/paper-dashboard-runtime-adapter.js";

function makeSession({ positions = [], events = [] } = {}) {
  const ledgerEvents = [
    { sequence: 1, eventId: "session_start_01", type: "SESSION_STARTED", timestamp: 1000, payload: { config: { mode: "PAPER_ONLY" } }, hash: "a".repeat(64) },
    ...events.map((event, i) => ({ sequence: i + 2, eventId: "event_" + String(i).padStart(4,"0"), timestamp: 1000 + i, hash: String(i).padStart(64,"0"), ...event }))
  ];
  return {
    snapshot: async () => ({
      mode: "PAPER_ONLY",
      broker: { cash: 9500, initialCash: 10000, positions, orders: [], feesPaid: 0 },
      ledger: { status: "COMPLETE", eventCount: ledgerEvents.length, lastSequence: ledgerEvents.length, lastHash: "f".repeat(64), events: ledgerEvents }
    }),
    riskStatus: () => ({ halted: false, allowed: true, status: "OK", haltReasons: [] })
  };
}

test("runtime adapter composes paper session, risk, feed, strategy and analytics as read-only view", async () => {
  const session = makeSession({positions:[{symbol:"BTCUSDT",quantity:0.1,averageCost:5000}]});
  const result = await createPaperDashboardRuntimeSnapshot({
    session,
    feedProvider: async () => ({status:{state:"CONNECTED"},quote:{symbol:"BTCUSDT",timestamp:2000,bid:60000,ask:60010,source:"TEST_FEED"}}),
    strategyProvider: async () => ({signal:{symbol:"BTCUSDT",side:"BUY",id:"sig_000001"},acceptance:{decision:"CONDITIONAL"}}),
    now: () => 2000
  });
  assert.equal(result.source.type,"IN_PROCESS_PAPER_SESSION");
  assert.equal(result.snapshot.mode,"PAPER_ONLY");
  assert.equal(result.viewModel.market.state,"HEALTHY");
  assert.equal(result.viewModel.strategy.decision,"CONDITIONAL");
  assert.equal(result.viewModel.permissions.maySubmitOrders,false);
  assert.equal(result.viewModel.permissions.mayMutateLedger,false);
  assert.equal(result.viewModel.portfolio.positionCount,1);
});

test("incomplete ledger snapshot is rejected, not displayed as complete", async () => {
  const session=makeSession();
  session.snapshot=async()=>({mode:"PAPER_ONLY",broker:{cash:1,initialCash:1,positions:[]},ledger:{status:"COMPLETE",eventCount:2,lastSequence:2,events:[]}});
  await assert.rejects(createPaperDashboardRuntimeSnapshot({session}),/incomplete or inconsistent/);
});

test("adapter rejects mutation-only or incompatible session handles", async () => {
  await assert.rejects(createPaperDashboardRuntimeSnapshot({session:{submitMarketOrder(){}}}),/read-only compatible/);
});

test("missing feed and strategy remain explicitly unavailable", async () => {
  const result=await createPaperDashboardRuntimeSnapshot({session:makeSession(),now:()=>2000});
  assert.equal(result.viewModel.market.state,"DISCONNECTED");
  assert.equal(result.viewModel.strategy.status,"NOT_EVALUATED");
});

test("stale quote is never projected as healthy", async () => {
  const result=await createPaperDashboardRuntimeSnapshot({
    session:makeSession(),
    feedProvider:async()=>({status:{state:"CONNECTED"},quote:{symbol:"BTCUSDT",timestamp:100,bid:100,ask:101}}),
    now:()=>2000,maxQuoteAgeMs:500
  });
  assert.equal(result.viewModel.market.state,"STALE");
  assert.equal(result.viewModel.market.bid,null);
});
