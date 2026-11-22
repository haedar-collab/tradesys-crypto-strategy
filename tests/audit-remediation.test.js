/**
 * Regression tests for the 2026-11-22 audit remediation:
 *  #1 rejected pre-trade risk checks must not latch the kill switch
 *  #2 interrupted orders can be resolved by an operator via an audited ledger event
 *  #3 provably stale ledger locks are reclaimed; live or unprovable locks are not
 *  #5 a failed ledger write poisons the handle and rolls back unacknowledged bytes
 *  #6 the 4H liquidity-sweep trigger reaches the SMC decision gate
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, open, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistentPaperSession } from "../src/paper/persistent-paper-session.js";
import { createPersistentPaperLedger } from "../src/paper/persistent-paper-ledger.js";
import { createPaperRiskMonitor } from "../src/risk/paper-risk-monitor.js";
import { auditPaperRecovery } from "../src/paper/paper-recovery-audit.js";
import {
  listPendingPaperOrderReviews,
  resolveInterruptedPaperOrder
} from "../src/paper/paper-recovery-operations.js";
import { buildCausalMultiTimeframeContext, toSweepEvidence, CAUSAL_MTF_INTERVALS } from "../src/engine/causal-mtf.js";
import { evaluateSmcSetup } from "../src/structure/decision.js";

const ACCEPT = { decision: "ACCEPT", eligibleForPaperTrading: true };
const T0 = 1_800_000_000_000;
async function tempDir() { return mkdtemp(join(tmpdir(), "tradesys-remediation-")); }
const buy = (id, quantity, timestamp = T0) => ({
  clientOrderId: id, symbol: "BTCUSDT", side: "BUY", quantity,
  quote: { timestamp, bid: 100, ask: 100.1 }, strategyAcceptance: ACCEPT
});

// ---------------------------------------------------------------- #1
test("#1 risk monitor preview never mutates baselines or latches the kill switch", () => {
  const monitor = createPaperRiskMonitor({ now: () => T0 });
  monitor.evaluate({ equity: 10_000, positions: [], timestamp: T0 });
  const before = monitor.status();
  const preview = monitor.preview({ equity: 9_000, positions: [{ quantity: 90, markPrice: 100 }], timestamp: T0 });
  assert.equal(preview.allowNewEntries, false);
  assert.ok(preview.reasons.includes("MAX_EXPOSURE_LIMIT_EXCEEDED"));
  assert.ok(preview.reasons.includes("DAILY_LOSS_LIMIT_REACHED"));
  const after = monitor.status();
  assert.equal(after.halted, false);
  assert.equal(after.peakEquity, before.peakEquity);
  assert.equal(after.dayStartEquity, before.dayStartEquity);
  assert.equal(after.events.length, before.events.length);
});

test("#1 risk monitor preview fails closed without a real baseline", () => {
  const monitor = createPaperRiskMonitor({ now: () => T0 });
  const preview = monitor.preview({ equity: 10_000, positions: [], timestamp: T0 });
  assert.equal(preview.allowNewEntries, false);
  assert.deepEqual(preview.reasons, ["RISK_BASELINE_UNAVAILABLE"]);
});

test("#1 an oversized BUY is rejected alone; compliant entries continue, including after restart", async () => {
  const dir = await tempDir(), filePath = join(dir, "events.jsonl");
  const now = () => T0;
  try {
    let session = await createPersistentPaperSession({ filePath, now });
    await assert.rejects(session.submitMarketOrder(buy("remed_big_0001", 90)), /MAX_EXPOSURE_LIMIT_EXCEEDED/);
    assert.equal(session.riskStatus().halted, false);
    // The projected (post-fee) equity must not become the day-start baseline.
    assert.equal(session.riskStatus().dayStartEquity, 10_000);
    assert.equal(session.riskStatus().peakEquity, 10_000);
    await session.close();

    session = await createPersistentPaperSession({ filePath, now });
    assert.equal(session.riskStatus().halted, false);
    const order = await session.submitMarketOrder(buy("remed_small_001", 1));
    assert.equal(order.status, "FILLED");
    await session.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("#1 a real breach still latches and reports KILL_SWITCH_LATCHED", async () => {
  const dir = await tempDir(), filePath = join(dir, "events.jsonl");
  try {
    const session = await createPersistentPaperSession({ filePath, now: () => T0 });
    await session.submitMarketOrder(buy("remed_real_0001", 50));
    const marked = await session.markToMarket({ BTCUSDT: { timestamp: T0, bid: 80, ask: 81 } });
    assert.equal(marked.risk.halted, true);
    await assert.rejects(session.submitMarketOrder(buy("remed_real_0002", 1)), /KILL_SWITCH_LATCHED/);
    await session.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- #2
async function crashAfterWriteAhead(filePath, id = "remed_crash_001") {
  await (await createPersistentPaperSession({ filePath, now: () => T0 })).close();
  const ledger = await createPersistentPaperLedger({ filePath });
  await ledger.append({
    eventId: "paper_crash_" + id, type: "ORDER_SUBMITTED", timestamp: T0,
    payload: { clientOrderId: id, orderInput: buy(id, 1) }
  });
  await ledger.close();
}

test("#2 an interrupted order blocks activation until an operator resolves it", async () => {
  const dir = await tempDir(), filePath = join(dir, "events.jsonl");
  try {
    await crashAfterWriteAhead(filePath);
    await assert.rejects(createPersistentPaperSession({ filePath, now: () => T0 }), /REVIEW/);
    await assert.rejects(createPersistentPaperSession({ filePath, now: () => T0 }), /REVIEW/);

    const pending = await listPendingPaperOrderReviews({ filePath });
    assert.deepEqual(pending.map(x => x.clientOrderId), ["remed_crash_001"]);

    const resolved = await resolveInterruptedPaperOrder({
      filePath, clientOrderId: "remed_crash_001", reviewer: "operator",
      note: "Paper only; no fill event exists and broker replay is unaffected.", now: () => T0
    });
    assert.equal(resolved.status, "REVIEW_RESOLVED");
    assert.deepEqual(await listPendingPaperOrderReviews({ filePath }), []);

    const session = await createPersistentPaperSession({ filePath, now: () => T0 });
    const audit = session.recoveryAudit();
    assert.equal(audit.status, "PASS");
    assert.ok(audit.findings.some(x => x.code === "INTERRUPTED_ORDER_REVIEW_RESOLVED" && x.severity === "INFO"));
    // The original intent stays rejected and is never replayed.
    await assert.rejects(session.submitMarketOrder(buy("remed_crash_001", 1)), /manual review required/);
    assert.equal((await session.snapshot()).broker.positions.length, 0);
    await session.close();

    await assert.rejects(resolveInterruptedPaperOrder({
      filePath, clientOrderId: "remed_crash_001", reviewer: "operator", note: "second attempt here", now: () => T0
    }), /no pending manual review/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("#2 resolution input is validated and requires a pending review", async () => {
  const dir = await tempDir(), filePath = join(dir, "events.jsonl");
  try {
    await (await createPersistentPaperSession({ filePath, now: () => T0 })).close();
    const base = { filePath, clientOrderId: "remed_none_0001", reviewer: "op", note: "evidence reviewed ok" };
    await assert.rejects(resolveInterruptedPaperOrder(base), /no pending manual review/);
    await assert.rejects(resolveInterruptedPaperOrder({ ...base, note: "short" }), /note must/);
    await assert.rejects(resolveInterruptedPaperOrder({ ...base, reviewer: " " }), /reviewer/);
    await assert.rejects(resolveInterruptedPaperOrder({ ...base, resolution: "FILLED" }), /resolution/);
    // The ledger lock is always released.
    await (await createPersistentPaperLedger({ filePath })).close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("#2 audit rejects forged or contradictory resolutions", () => {
  const header = { eventId: "session_start_x", type: "SESSION_STARTED", payload: { config: {} } };
  const intent = { eventId: "sub_x_000001", type: "ORDER_SUBMITTED", payload: { clientOrderId: "order_x_0001" } };
  const reject = { eventId: "rej_x_000001", type: "ORDER_REJECTED", payload: { clientOrderId: "order_x_0001", message: "submission interrupted before durable fill; manual review required" } };
  const plainReject = { ...reject, payload: { clientOrderId: "order_x_0001", message: "insufficient paper cash" } };
  const resolution = (extra = {}) => ({ eventId: "review_x_00001", type: "OPERATOR_REVIEW_RESOLVED",
    payload: { clientOrderId: "order_x_0001", resolution: "CONFIRMED_NOT_FILLED", reviewer: "op", note: "checked evidence", ...extra } });
  const risk = { eventId: "risk_x_000001", type: "RISK_EVENT", payload: { state: { halted: false } } };
  const audit = events => auditPaperRecovery({
    ledgerSnapshot: { status: "COMPLETE", events, eventCount: events.length, lastSequence: events.length, lastHash: "h" },
    brokerSnapshot: { orders: [], positions: [], cash: 10_000 }, initialCash: 10_000
  });
  const codes = r => r.findings.map(x => x.code);

  assert.equal(audit([header, risk, intent, reject, resolution()]).status, "PASS");
  assert.ok(codes(audit([header, risk, intent, plainReject, resolution()])).includes("OPERATOR_REVIEW_RESOLUTION_WITHOUT_PENDING_REVIEW"));
  assert.ok(codes(audit([header, risk, intent, resolution(), reject])).includes("OPERATOR_REVIEW_RESOLUTION_WITHOUT_PENDING_REVIEW"));
  assert.ok(codes(audit([header, risk, intent, reject, resolution({ resolution: "WHATEVER" })])).includes("OPERATOR_REVIEW_RESOLUTION_INVALID"));
  assert.ok(codes(audit([header, risk, intent, reject, resolution({ note: "" })])).includes("OPERATOR_REVIEW_RESOLUTION_INVALID"));
  const dup = { ...resolution(), eventId: "review_x_00002" };
  assert.ok(codes(audit([header, risk, intent, reject, resolution(), dup])).includes("DUPLICATE_OPERATOR_REVIEW_RESOLUTION"));
  assert.equal(audit([header, risk, intent, reject]).status, "REVIEW");
});

// ---------------------------------------------------------------- #3
async function lockFixture() {
  const dir = await tempDir(), filePath = join(dir, "paper", "events.jsonl");
  await mkdir(join(dir, "paper"), { recursive: true });
  const bootId = (await readFile("/proc/sys/kernel/random/boot_id", "utf8").catch(() => "")).trim();
  return { dir, filePath, bootId };
}
const hasProc = (await readFile("/proc/sys/kernel/random/boot_id", "utf8").catch(() => null)) !== null;

test("#3 a lock whose PID was reused by another process (container restart) is reclaimed", { skip: !hasProc && "requires /proc" }, async () => {
  const f = await lockFixture();
  try {
    // Same PID as this process, but a different start time: the classic
    // container restart where the app is pid 7 every time.
    await writeFile(f.filePath + ".lock", JSON.stringify({
      token: "previous-container", pid: process.pid, createdAt: 1, hostname: hostname(),
      bootId: f.bootId, processStartTime: "1"
    }));
    const ledger = await createPersistentPaperLedger({ filePath: f.filePath });
    assert.equal(ledger.reclaimedStaleLock.pid, process.pid);
    await ledger.close();
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("#3 a lock from a previous boot is reclaimed", { skip: !hasProc && "requires /proc" }, async () => {
  const f = await lockFixture();
  try {
    await writeFile(f.filePath + ".lock", JSON.stringify({
      token: "before-reboot", pid: process.pid, createdAt: 1, hostname: hostname(),
      bootId: "00000000-0000-0000-0000-000000000000", processStartTime: "1"
    }));
    const ledger = await createPersistentPaperLedger({ filePath: f.filePath });
    assert.ok(ledger.reclaimedStaleLock);
    await ledger.close();
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("#3 unprovable locks still fail closed: live owner, other host, or legacy format", async () => {
  const f = await lockFixture();
  try {
    const holder = await createPersistentPaperLedger({ filePath: f.filePath });
    await assert.rejects(createPersistentPaperLedger({ filePath: f.filePath }), /locked by another process/);
    await holder.close();

    for (const lock of [
      { token: "other-host", pid: 999_999, createdAt: 1, hostname: "some-other-host", bootId: "x", processStartTime: "1" },
      { token: "legacy-format", pid: 999_999, createdAt: 1 },
      "not json"
    ]) {
      await writeFile(f.filePath + ".lock", typeof lock === "string" ? lock : JSON.stringify(lock));
      await assert.rejects(createPersistentPaperLedger({ filePath: f.filePath }), /manual review required/);
      assert.equal(await readFile(f.filePath + ".lock", "utf8"), typeof lock === "string" ? lock : JSON.stringify(lock));
    }
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- #5
const event = id => ({ eventId: id, type: "ORDER_FILLED", timestamp: T0, payload: { symbol: "BTCUSDT", quantity: 0.1 } });

test("#5 a failed fsync rolls back the unacknowledged record and poisons the ledger", async () => {
  const f = await lockFixture();
  const probe = await open(join(f.dir, "probe"), "w");
  const FileHandle = probe.constructor;
  await probe.close();
  const originalSync = FileHandle.prototype.sync;
  try {
    const ledger = await createPersistentPaperLedger({ filePath: f.filePath });
    await ledger.append(event("remed_ok_00001"));
    const goodBytes = await readFile(f.filePath, "utf8");

    FileHandle.prototype.sync = async function () { throw Object.assign(new Error("EIO: simulated fsync failure"), { code: "EIO" }); };
    await assert.rejects(ledger.append(event("remed_fail_0001")), /EIO/);
    FileHandle.prototype.sync = originalSync;

    assert.equal(ledger.isPoisoned(), true);
    assert.equal(await readFile(f.filePath, "utf8"), goodBytes, "unacknowledged bytes must be rolled back");
    await assert.rejects(ledger.append(event("remed_after_001")), /unavailable after a failed write/);
    await ledger.close();

    const reopened = await createPersistentPaperLedger({ filePath: f.filePath });
    const state = await reopened.snapshot();
    assert.deepEqual(state.events.map(e => e.eventId), ["remed_ok_00001"]);
    await reopened.append(event("remed_next_0001"));
    assert.equal((await reopened.snapshot()).eventCount, 2);
    await reopened.close();
  } finally {
    FileHandle.prototype.sync = originalSync;
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("#5 a failed open poisons the ledger instead of desynchronising its sequence", async () => {
  const f = await lockFixture();
  try {
    const ledger = await createPersistentPaperLedger({ filePath: f.filePath });
    await ledger.append(event("remed_ok_00002"));
    const aside = f.filePath + ".aside";
    await rename(f.filePath, aside);
    await mkdir(f.filePath);                       // appending to a directory fails (EISDIR)
    await assert.rejects(ledger.append(event("remed_fail_0002")));
    await rmdir(f.filePath);
    await rename(aside, f.filePath);
    // Even though the file is healthy again, this handle refuses to write.
    await assert.rejects(ledger.append(event("remed_fail_0003")), /unavailable after a failed write/);
    await ledger.close();
    const reopened = await createPersistentPaperLedger({ filePath: f.filePath });
    assert.equal((await reopened.snapshot()).eventCount, 1);
    await reopened.close();
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- #6
const SMC_BASE = {
  dailyBias: "Bullish", trend4h: "Bullish", price: 97, close4h: 97, atr4h: 2,
  zone: { lo: 95, hi: 98 }, plan: { entry: 96.5, stop: 93, tp1: 102, tp2: 110, tp3: 115 },
  ltf: { state: "none" }, rejection4h: false
};

test("#6 sweep evidence maps to a confirmed trigger the decision gate accepts", () => {
  assert.equal(toSweepEvidence(null), null);
  assert.equal(toSweepEvidence({ px: Number.NaN, at: 1 }), null);
  const evidence = toSweepEvidence({ px: 89, at: 360_000 });
  assert.deepEqual(evidence, { confirmed: true, px: 89, at: 360_000, kind: "SELL_SIDE_SWEEP_RECLAIM" });
  const decision = evaluateSmcSetup({ ...SMC_BASE, liquiditySweep: evidence });
  assert.equal(decision.status, "BUY_CANDIDATE");
  assert.equal(decision.trigger, "LIQUIDITY_SWEEP");
  assert.ok(decision.evidence.includes("LIQUIDITY_SWEEP_RECLAIM"));
  // Regression: the former boolean contract never triggered.
  assert.ok(evaluateSmcSetup({ ...SMC_BASE, liquiditySweep: true }).reasons.includes("NO_CONFIRMED_ENTRY_TRIGGER"));
});

test("#6 the causal 4H context carries a confirmed sweep object, not a boolean", () => {
  const now = Date.UTC(2026, 10, 20, 12, 0, 0);
  const series = (key, count, interval) => {
    let anchor;
    if (key === "weekly") {
      const d = new Date(now); const day = (d.getUTCDay() + 6) % 7;
      anchor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * 86400000 - interval;
    } else if (key === "daily") {
      anchor = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()) - interval;
    } else anchor = Math.floor(now / interval) * interval - interval;
    return Array.from({ length: count }, (_, i) => {
      const openTime = anchor - (count - 1 - i) * interval;
      const close = 100 + i * .08 + Math.sin(i / 6);
      return { openTime, closeTime: openTime + interval - 1, open: close - .1, high: close + .7, low: close - .7, close, volume: 1000 };
    });
  };
  const input = {
    weekly: series("weekly", 230, CAUSAL_MTF_INTERVALS.weekly),
    daily: series("daily", 230, CAUSAL_MTF_INTERVALS.daily),
    h4: series("h4", 90, CAUSAL_MTF_INTERVALS.h4),
    h1: series("h1", 90, CAUSAL_MTF_INTERVALS.h1)
  };
  // Wick the second-to-last 4H candle below every recent low, closing back above.
  const h4 = input.h4, k = h4.length - 2;
  h4[k].low = Math.min(...h4.slice(-60).map(c => c.low)) - 1;
  const built = buildCausalMultiTimeframeContext(input, { evaluationTime: now });
  assert.equal(built.status, "READY");
  const sweep = built.context.h4.liquiditySweep;
  assert.equal(typeof sweep, "object");
  assert.equal(sweep.confirmed, true);
  assert.equal(sweep.at, h4[k].openTime);
  assert.ok(sweep.px > h4[k].low && sweep.px < h4[k].close);
});
