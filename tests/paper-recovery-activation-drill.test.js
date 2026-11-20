import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createPersistentPaperLedger } from "../src/paper/persistent-paper-ledger.js";
import { createPersistentPaperSession } from "../src/paper/persistent-paper-session.js";

const config = { mode: "PAPER_ONLY", initialCash: 10_000, feeBps: 10, slippageBps: 5,
  maxQuoteAgeMs: 5_000, riskMarkMaxAgeMs: 60_000, dailyLossLimitPct: 3, maxDrawdownPct: 10, maxExposurePct: 80 };
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "tradesys-recovery-activation-"));
  return { dir, filePath: join(dir, "events.jsonl") };
}
function interruptedInput(now) {
  return { clientOrderId: "activation_crash_01", symbol: "BTCUSDT", side: "BUY", quantity: 0.1,
    quote: { timestamp: now, bid: 99, ask: 100 }, strategyAcceptance: { decision: "ACCEPT", eligibleForPaperTrading: true },
    riskGate: { allowed: true } };
}
async function seedInterruptedLedger(filePath, now) {
  const ledger = await createPersistentPaperLedger({ filePath });
  const input = interruptedInput(now);
  await ledger.append({ eventId: "session_start_activation", type: "SESSION_STARTED", timestamp: now, payload: { config } });
  const suffix = createHash("sha256").update(input.clientOrderId).digest("hex").slice(0, 32);
  await ledger.append({ eventId: "paper_" + suffix + "_submitted", type: "ORDER_SUBMITTED", timestamp: now,
    payload: { clientOrderId: input.clientOrderId, orderInput: input } });
  await ledger.close();
}

test("failed recovery activation releases the ledger lock and preserves review evidence", async () => {
  const f = await fixture(), now = 1_800_000_000_000;
  try {
    await seedInterruptedLedger(f.filePath, now);
    await assert.rejects(createPersistentPaperSession({ filePath: f.filePath, now: () => now }), error => {
      assert.equal(error.recoveryAudit.status, "REVIEW");
      return true;
    });
    await assert.rejects(access(f.filePath + ".lock"), { code: "ENOENT" });
    const verified = await import("../src/paper/persistent-paper-ledger.js").then(async m =>
      m.verifyPaperLedger(await readFile(f.filePath, "utf8")));
    assert.equal(verified.events.filter(e => e.type === "ORDER_REJECTED").length, 1);
    assert.ok(verified.events.some(e => e.type === "ORDER_SUBMITTED"));
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("repeated blocked recovery is deterministic and does not duplicate interrupted-order rejection", async () => {
  const f = await fixture(), now = 1_800_000_000_000;
  try {
    await seedInterruptedLedger(f.filePath, now);
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(createPersistentPaperSession({ filePath: f.filePath, now: () => now }), error => {
        assert.equal(error.recoveryAudit.status, "REVIEW");
        assert.ok(error.recoveryAudit.findings.some(x => x.code === "INTERRUPTED_ORDER_REQUIRES_MANUAL_REVIEW"));
        return true;
      });
    }
    const { verifyPaperLedger } = await import("../src/paper/persistent-paper-ledger.js");
    const snapshot = verifyPaperLedger(await readFile(f.filePath, "utf8"));
    assert.equal(snapshot.events.filter(e => e.type === "ORDER_REJECTED").length, 1);
    assert.equal(snapshot.events.filter(e => e.type === "ORDER_FILLED").length, 0);
    await assert.rejects(access(f.filePath + ".lock"), { code: "ENOENT" });
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
