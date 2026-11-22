import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistentPaperSession } from "../src/paper/persistent-paper-session.js";
import { createPersistentPaperLedger } from "../src/paper/persistent-paper-ledger.js";
import { createPaperRiskMonitor } from "../src/risk/paper-risk-monitor.js";

const ACCEPT = { decision: "ACCEPT", eligibleForPaperTrading: true };
const ALLOW = { allowed: true };
const quote = (timestamp, bid = 99, ask = 101) => ({ timestamp, bid, ask });
function fixture() {
  let clock = 1_800_000_000_000;
  return {
    now: () => clock,
    advance: (ms) => { clock += ms; },
    dirPromise: mkdtemp(join(tmpdir(), "tradesys-session-"))
  };
}
async function orderInput(now, id = "session_buy_0001") {
  return {
    clientOrderId: id, symbol: "BTCUSDT", side: "BUY", quantity: 0.25,
    quote: quote(now()), strategyAcceptance: ACCEPT, riskGate: ALLOW
  };
}

test("integrated session persists broker fills and restores cash and positions after restart", async () => {
  const f = fixture(), dir = await f.dirPromise, filePath = join(dir, "events.jsonl");
  try {
    let session = await createPersistentPaperSession({ filePath, now: f.now });
    const input = await orderInput(f.now);
    await session.submitMarketOrder(input);
    const before = await session.snapshot();
    assert.equal(before.ledger.eventCount, 5);
    assert.equal(before.broker.positions[0].quantity, 0.25);
    const cashBefore = before.broker.cash;
    await session.close();

    session = await createPersistentPaperSession({ filePath, now: f.now });
    const after = await session.snapshot();
    assert.equal(after.broker.positions[0].quantity, 0.25);
    assert.equal(after.broker.cash, cashBefore);
    assert.equal(after.ledger.eventCount, 6);
    await session.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("integrated order submission is idempotent across calls and restarts", async () => {
  const f = fixture(), dir = await f.dirPromise, filePath = join(dir, "events.jsonl");
  try {
    let session = await createPersistentPaperSession({ filePath, now: f.now });
    const input = await orderInput(f.now, "session_buy_0002");
    const first = await session.submitMarketOrder(input);
    const second = await session.submitMarketOrder(input);
    assert.deepEqual(first, second);
    await session.close();
    session = await createPersistentPaperSession({ filePath, now: f.now });
    assert.deepEqual(await session.submitMarketOrder(input), first);
    await session.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("recovery rejects an interrupted write-ahead submission instead of auto-executing it", async () => {
  const f = fixture(), dir = await f.dirPromise, filePath = join(dir, "events.jsonl");
  try {
    const input = await orderInput(f.now, "session_buy_0003");
    const ledger = await (await import("../src/paper/persistent-paper-ledger.js")).createPersistentPaperLedger({ filePath });
    await ledger.append({ eventId: "session_start_0001", type: "SESSION_STARTED", timestamp: f.now(), payload: { config: { mode: "PAPER_ONLY", initialCash: 10_000, feeBps: 10, slippageBps: 5, maxQuoteAgeMs: 5_000, riskMarkMaxAgeMs: 60_000, dailyLossLimitPct: 3, maxDrawdownPct: 10, maxExposurePct: 80 } } });
    const { createHash } = await import("node:crypto");
    const eventId = "paper_" + createHash("sha256").update(input.clientOrderId).digest("hex").slice(0, 32) + "_submitted";
    await ledger.append({ eventId, type: "ORDER_SUBMITTED", timestamp: f.now(), payload: { clientOrderId: input.clientOrderId, orderInput: input } });
    await ledger.close();

    await assert.rejects(createPersistentPaperSession({ filePath, now: f.now }), error => {
      assert.equal(error.recoveryAudit.status, "REVIEW");
      assert.ok(error.recoveryAudit.findings.some(x => x.code === "INTERRUPTED_ORDER_REQUIRES_MANUAL_REVIEW"));
      return true;
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("records rejected orders durably and rejects changed input for reused client id", async () => {
  const f = fixture(), dir = await f.dirPromise, filePath = join(dir, "events.jsonl");
  try {
    let session = await createPersistentPaperSession({ filePath, now: f.now });
    const input = { ...await orderInput(f.now, "session_buy_0004"), riskGate: { allowed: false } };
    await assert.rejects(session.submitMarketOrder(input), /risk gate/);
    const state = await session.snapshot();
    assert.ok(state.ledger.events.some(e => e.type === "ORDER_REJECTED"));
    await assert.rejects(session.submitMarketOrder({ ...input, quantity: 0.5 }), /different order input/);
    await session.close();
    session = await createPersistentPaperSession({ filePath, now: f.now });
    await assert.rejects(session.submitMarketOrder(input), /risk gate/);
    await session.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("persists mark-to-market events without altering broker positions", async () => {
  const f = fixture(), dir = await f.dirPromise, filePath = join(dir, "events.jsonl");
  try {
    const session = await createPersistentPaperSession({ filePath, now: f.now });
    await session.submitMarketOrder(await orderInput(f.now, "session_buy_0005"));
    const mark = await session.markToMarket({ BTCUSDT: quote(f.now(), 105, 106) });
    const state = await session.snapshot();
    assert.ok(mark.equity > 0);
    assert.ok(state.ledger.events.some(e => e.type === "POSITION_MARKED"));
    assert.equal(state.broker.positions[0].quantity, 0.25);
    await session.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test("persistent risk gate blocks a projected entry above maximum exposure", async () => {
  const f = fixture(), dir = await f.dirPromise, filePath = join(dir, "events.jsonl");
  try {
    const session = await createPersistentPaperSession({ filePath, now: f.now });
    const input = {
      ...await orderInput(f.now, "session_risk_exp_001"),
      quantity: 90
    };
    await assert.rejects(session.submitMarketOrder(input), /MAX_EXPOSURE_LIMIT_EXCEEDED/);
    const state = await session.snapshot();
    assert.equal(state.broker.positions.length, 0);
    // The oversized order is rejected on its own; the session is NOT halted.
    assert.equal(state.risk.halted, false);
    assert.ok(state.ledger.events.some(e => e.type === "RISK_EVENT"));
    const small = await session.submitMarketOrder(await orderInput(f.now, "session_risk_exp_002"));
    assert.equal(small.status, "FILLED");
    await session.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("kill switch remains latched after restart and blocks new BUY entries", async () => {
  const f = fixture(), dir = await f.dirPromise, filePath = join(dir, "events.jsonl");
  try {
    let session = await createPersistentPaperSession({ filePath, now: f.now });
    await session.activateKillSwitch("OPERATOR_STOP");
    await session.close();

    session = await createPersistentPaperSession({ filePath, now: f.now });
    const state = await session.snapshot();
    assert.equal(state.risk.halted, true);
    assert.deepEqual(state.risk.haltReasons, ["OPERATOR_STOP"]);
    const input = await orderInput(f.now, "session_risk_halt_01");
    await assert.rejects(session.submitMarketOrder(input), /KILL_SWITCH_LATCHED/);
    await session.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("mark-to-market breach persists the kill switch and it survives restart", async () => {
  const f = fixture(), dir = await f.dirPromise, filePath = join(dir, "events.jsonl");
  try {
    let session = await createPersistentPaperSession({ filePath, now: f.now });
    await session.submitMarketOrder({ ...await orderInput(f.now, "session_risk_mark_1"), quantity: 50 });
    const marked = await session.markToMarket({ BTCUSDT: quote(f.now(), 80, 81) });
    assert.equal(marked.risk.halted, true);
    assert.ok(marked.risk.reasons.includes("DAILY_LOSS_LIMIT_REACHED") ||
      marked.risk.reasons.includes("MAX_DRAWDOWN_LIMIT_REACHED"));
    await session.close();

    session = await createPersistentPaperSession({ filePath, now: f.now });
    assert.equal((await session.snapshot()).risk.halted, true);
    await assert.rejects(session.submitMarketOrder(await orderInput(f.now, "session_risk_mark_2")), /KILL_SWITCH_LATCHED/);
    await session.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test("prevents a second persistent session from opening the same ledger concurrently", async () => {
  const f = fixture(), dir = await f.dirPromise, filePath = join(dir, "events.jsonl");
  try {
    const first = await createPersistentPaperSession({ filePath, now: f.now });
    await assert.rejects(
      createPersistentPaperSession({ filePath, now: f.now }),
      /locked by another process/
    );
    await first.close();
    const second = await createPersistentPaperSession({ filePath, now: f.now });
    await second.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test("serializes concurrent duplicate submissions to one durable fill", async () => {
  const f = fixture(), dir = await f.dirPromise, filePath = join(dir, "events.jsonl");
  try {
    const paper = await createPersistentPaperSession({ filePath, now: f.now });
    const input = await orderInput(f.now, "session_concurrent_01");
    const [first, second, third] = await Promise.all([
      paper.submitMarketOrder(input),
      paper.submitMarketOrder(input),
      paper.submitMarketOrder(input)
    ]);
    assert.deepEqual(first, second);
    assert.deepEqual(second, third);
    const state = await paper.snapshot();
    assert.equal(state.ledger.events.filter(e => e.type === "ORDER_FILLED").length, 1);
    await paper.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test("recovery rejects a submission interrupted after its durable risk check", async () => {
  const f = fixture(), dir = await f.dirPromise, filePath = join(dir, "events.jsonl");
  try {
    const input = await orderInput(f.now, "session_crash_risk_01");
    const ledger = await createPersistentPaperLedger({ filePath });
    const riskMonitor = createPaperRiskMonitor({ now: f.now });
    riskMonitor.evaluate({ equity: 10_000, positions: [], timestamp: f.now() });
    const state = { ...riskMonitor.status(), events: [] };
    const { createHash } = await import("node:crypto");
    await ledger.append({ eventId: "session_start_0002", type: "SESSION_STARTED", timestamp: f.now(), payload: { config: { mode: "PAPER_ONLY", initialCash: 10_000, feeBps: 10, slippageBps: 5, maxQuoteAgeMs: 5_000, riskMarkMaxAgeMs: 60_000, dailyLossLimitPct: 3, maxDrawdownPct: 10, maxExposurePct: 80 } } });
    const digest = createHash("sha256").update(JSON.stringify({
      reason: "ORDER_ENTRY_CHECK", timestamp: f.now(), sequence: 2, state
    })).digest("hex");
    const submittedId = "paper_" + createHash("sha256").update(input.clientOrderId).digest("hex").slice(0, 32) + "_submitted";
    await ledger.append({
      eventId: submittedId, type: "ORDER_SUBMITTED", timestamp: f.now(),
      payload: { clientOrderId: input.clientOrderId, orderInput: input }
    });
    await ledger.append({
      eventId: "risk_" + digest.slice(0, 48), type: "RISK_EVENT", timestamp: f.now(),
      payload: { reason: "ORDER_ENTRY_CHECK", state }
    });
    await ledger.close();

    await assert.rejects(createPersistentPaperSession({ filePath, now: f.now }), error => {
      assert.equal(error.recoveryAudit.status, "REVIEW");
      assert.ok(error.recoveryAudit.findings.some(x => x.code === "INTERRUPTED_ORDER_REQUIRES_MANUAL_REVIEW"));
      return true;
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test("immutable session configuration mismatch blocks activation and releases the ledger lock", async () => {
  const f = fixture(), dir = await f.dirPromise, filePath = join(dir, "events.jsonl");
  try {
    const first = await createPersistentPaperSession({ filePath, now: f.now });
    await first.close();
    await assert.rejects(
      createPersistentPaperSession({ filePath, now: f.now, initialCash: 20_000 }),
      /configuration differs from immutable ledger header/
    );
    const reopened = await createPersistentPaperSession({ filePath, now: f.now });
    assert.equal((await reopened.snapshot()).broker.initialCash, 10_000);
    await reopened.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
