import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistentPaperSession } from "../src/paper/persistent-paper-session.js";

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
    assert.equal(before.ledger.eventCount, 2);
    assert.equal(before.broker.positions[0].quantity, 0.25);
    const cashBefore = before.broker.cash;
    await session.close();

    session = await createPersistentPaperSession({ filePath, now: f.now });
    const after = await session.snapshot();
    assert.equal(after.broker.positions[0].quantity, 0.25);
    assert.equal(after.broker.cash, cashBefore);
    assert.equal(after.ledger.eventCount, 3);
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

test("recovery completes a write-ahead submission interrupted before fill event", async () => {
  const f = fixture(), dir = await f.dirPromise, filePath = join(dir, "events.jsonl");
  try {
    const session = await createPersistentPaperSession({ filePath, now: f.now });
    const input = await orderInput(f.now, "session_buy_0003");
    // Simulate durable intent written before the process crashes.
    const ledger = await (await import("../src/paper/persistent-paper-ledger.js")).createPersistentPaperLedger({ filePath });
    const { createHash } = await import("node:crypto");
    const eventId = "paper_" + createHash("sha256").update(input.clientOrderId).digest("hex").slice(0, 32) + "_submitted";
    await ledger.append({ eventId, type: "ORDER_SUBMITTED", timestamp: f.now(), payload: { clientOrderId: input.clientOrderId, orderInput: input } });
    await ledger.close();
    await session.close();

    const recovered = await createPersistentPaperSession({ filePath, now: f.now });
    const state = await recovered.snapshot();
    assert.equal(state.broker.positions[0].quantity, 0.25);
    assert.ok(state.ledger.events.some(e => e.type === "ORDER_FILLED"));
    await recovered.close();
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
