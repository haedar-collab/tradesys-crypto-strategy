import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistentPaperLedger } from "../src/paper/persistent-paper-ledger.js";
import { dryRunLegacyPaperLedgerMigration, exportPaperRecoveryReport, formatPaperRecoveryReport, inspectPaperLedgerFile, verifyPaperLedgerBackup } from "../src/paper/paper-recovery-operations.js";

const config = { mode: "PAPER_ONLY", initialCash: 10_000, feeBps: 10, slippageBps: 5,
  maxQuoteAgeMs: 5_000, riskMarkMaxAgeMs: 60_000, dailyLossLimitPct: 3, maxDrawdownPct: 10, maxExposurePct: 80 };
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "tradesys-recovery-ops-"));
  return { dir, sourcePath: join(dir, "legacy.jsonl"), destinationPath: join(dir, "migrated.jsonl"), reportPath: join(dir, "audit.json") };
}
async function createLegacy(path) {
  const ledger = await createPersistentPaperLedger({ filePath: path });
  await ledger.append({ eventId: "legacy_event_01", type: "RISK_EVENT", timestamp: 1_700_000_000_000, payload: { state: { halted: false } } });
  await ledger.close();
}

test("preflight verifies ledger and reports legacy/header status without mutation", async () => {
  const f = await fixture();
  try {
    await createLegacy(f.sourcePath);
    const before = await readFile(f.sourcePath, "utf8");
    const result = await inspectPaperLedgerFile({ filePath: f.sourcePath });
    assert.equal(result.status, "LEGACY_LEDGER");
    assert.equal(result.eventCount, 1);
    assert.equal(result.migrationEligibleByStructure, true);
    assert.equal(await readFile(f.sourcePath, "utf8"), before);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("preflight reports present stale lock and never removes it", async () => {
  const f = await fixture();
  try {
    await createLegacy(f.sourcePath);
    await writeFile(f.sourcePath + ".lock", JSON.stringify({ token: "stale", pid: 123, createdAt: 456 }));
    const result = await inspectPaperLedgerFile({ filePath: f.sourcePath });
    assert.equal(result.status, "LOCKED_OR_STALE");
    assert.equal(result.migrationEligibleByStructure, false);
    await access(f.sourcePath + ".lock");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("dry-run is deterministic and performs no writes", async () => {
  const f = await fixture();
  try {
    await createLegacy(f.sourcePath);
    const before = await readFile(f.sourcePath, "utf8");
    const args = { ...f, config, migrationTimestamp: 1_800_000_000_000 };
    const first = await dryRunLegacyPaperLedgerMigration(args);
    const second = await dryRunLegacyPaperLedgerMigration(args);
    assert.deepEqual(first, second);
    assert.equal(first.status, "DRY_RUN_VALID");
    assert.equal(first.writesPerformed, false);
    assert.equal(await readFile(f.sourcePath, "utf8"), before);
    await assert.rejects(access(f.destinationPath), { code: "ENOENT" });
    await assert.rejects(access(f.sourcePath + ".lock"), { code: "ENOENT" });
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("dry-run rejects existing destination, source lock, and corrupt source", async () => {
  const f = await fixture();
  try {
    await createLegacy(f.sourcePath);
    await writeFile(f.destinationPath, "do-not-overwrite");
    await assert.rejects(dryRunLegacyPaperLedgerMigration({ ...f, config }), /destination already exists/);
    await rm(f.destinationPath);
    await writeFile(f.sourcePath + ".lock", "{stale");
    await assert.rejects(dryRunLegacyPaperLedgerMigration({ ...f, config }), /locked or has a stale lock/);
    await rm(f.sourcePath + ".lock");
    await writeFile(f.sourcePath, "broken\n");
    await assert.rejects(dryRunLegacyPaperLedgerMigration({ ...f, config }), /invalid JSON/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("report formatting is deterministic and export refuses overwrite", async () => {
  const f = await fixture();
  try {
    const report = { status: "REVIEW", summary: { critical: 0, error: 1 }, findings: [
      { severity: "ERROR", code: "AMBIGUOUS_ORDER_INTENT", message: "Needs review", reference: "order_1", action: "Inspect evidence" }
    ] };
    assert.equal(formatPaperRecoveryReport(report), formatPaperRecoveryReport(report));
    assert.match(formatPaperRecoveryReport(report), /AMBIGUOUS_ORDER_INTENT/);
    const result = await exportPaperRecoveryReport({ report, filePath: f.reportPath, format: "json" });
    assert.equal(result.status, "REPORT_EXPORTED");
    assert.deepEqual(JSON.parse(await readFile(f.reportPath, "utf8")), report);
    await assert.rejects(exportPaperRecoveryReport({ report, filePath: f.reportPath }), { code: "EEXIST" });
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("report formatter rejects unsupported formats", () => {
  assert.throws(() => formatPaperRecoveryReport({ status: "PASS" }, { format: "yaml" }), /format must be text or json/);
});


test("backup verification passes only for byte-identical valid ledger copies", async () => {
  const f = await fixture();
  const backupPath = join(f.dir, "backup.jsonl");
  try {
    await createLegacy(f.sourcePath);
    await writeFile(backupPath, await readFile(f.sourcePath));
    const result = await verifyPaperLedgerBackup({ sourcePath: f.sourcePath, backupPath });
    assert.equal(result.status, "PASS");
    assert.equal(result.byteIdentical, true);
    assert.equal(result.sourceLedgerValid, true);
    assert.equal(result.backupLedgerValid, true);
    assert.equal(result.sourceSha256, result.backupSha256);
    assert.equal(result.sourceEventCount, 1);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("backup verification detects changed bytes and invalid backup without mutation", async () => {
  const f = await fixture();
  const backupPath = join(f.dir, "backup.jsonl");
  try {
    await createLegacy(f.sourcePath);
    await writeFile(backupPath, (await readFile(f.sourcePath, "utf8")).replace("legacy_event_01", "legacy_event_02"));
    const mismatch = await verifyPaperLedgerBackup({ sourcePath: f.sourcePath, backupPath });
    assert.equal(mismatch.status, "INVALID");
    assert.equal(mismatch.byteIdentical, false);
    await writeFile(backupPath, await readFile(f.sourcePath));
    await writeFile(f.sourcePath + ".lock", JSON.stringify({ pid: 999, createdAt: 1 }));
    const locked = await verifyPaperLedgerBackup({ sourcePath: f.sourcePath, backupPath });
    assert.equal(locked.status, "REVIEW");
    assert.equal(locked.sourceLocked, true);
    await access(f.sourcePath + ".lock");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("backup verification rejects same path and missing files", async () => {
  const f = await fixture();
  try {
    await assert.rejects(verifyPaperLedgerBackup({ sourcePath: f.sourcePath, backupPath: f.sourcePath }), /paths must differ/);
    await assert.rejects(verifyPaperLedgerBackup({ sourcePath: f.sourcePath, backupPath: f.destinationPath }), { code: "ENOENT" });
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
