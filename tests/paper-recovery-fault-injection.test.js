import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistentPaperLedger } from "../src/paper/persistent-paper-ledger.js";
import { migrateLegacyPaperLedger } from "../src/paper/legacy-paper-ledger-migration.js";
import { exportPaperRecoveryReport, inspectPaperLedgerFile } from "../src/paper/paper-recovery-operations.js";

const config = { mode: "PAPER_ONLY", initialCash: 10_000, feeBps: 10, slippageBps: 5,
  maxQuoteAgeMs: 5_000, riskMarkMaxAgeMs: 60_000, dailyLossLimitPct: 3, maxDrawdownPct: 10, maxExposurePct: 80 };
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "tradesys-fault-injection-"));
  return { dir, sourcePath: join(dir, "legacy.jsonl"), destinationPath: join(dir, "migrated.jsonl"), reportPath: join(dir, "report.json") };
}
async function createLegacy(path) {
  const ledger = await createPersistentPaperLedger({ filePath: path });
  await ledger.append({ eventId: "legacy_fault_01", type: "RISK_EVENT", timestamp: 1_700_000_000_000, payload: { state: { halted: false } } });
  await ledger.close();
}

test("migration validation failure releases its own lock and preserves the source", async () => {
  const f = await fixture();
  try {
    await createLegacy(f.sourcePath);
    const original = await readFile(f.sourcePath, "utf8");
    await writeFile(f.sourcePath, original.replace("halted", "corrupt"));
    const corrupted = await readFile(f.sourcePath, "utf8");
    await assert.rejects(migrateLegacyPaperLedger({ ...f, config, migrationTimestamp: 1_800_000_000_000 }), /checksum mismatch/);
    assert.equal(await readFile(f.sourcePath, "utf8"), corrupted);
    await assert.rejects(access(f.sourcePath + ".lock"), { code: "ENOENT" });
    await assert.rejects(access(f.destinationPath), { code: "ENOENT" });
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("simulated interrupted migration remains fail-closed and leaves evidence untouched", async () => {
  const f = await fixture();
  try {
    await createLegacy(f.sourcePath);
    const sourceBefore = await readFile(f.sourcePath, "utf8");
    const staleLock = JSON.stringify({ token: "crashed-process", pid: 999999, createdAt: 1, purpose: "LEGACY_LEDGER_MIGRATION" }) + "\n";
    const orphanTemp = f.destinationPath + ".migration-crash.tmp";
    await writeFile(f.sourcePath + ".lock", staleLock);
    await writeFile(orphanTemp, "{partial");
    const inspection = await inspectPaperLedgerFile({ filePath: f.sourcePath });
    assert.equal(inspection.status, "LOCKED_OR_STALE");
    await assert.rejects(migrateLegacyPaperLedger({ ...f, config, migrationTimestamp: 1_800_000_000_000 }), /locked or has a stale lock/);
    assert.equal(await readFile(f.sourcePath, "utf8"), sourceBefore);
    assert.equal(await readFile(f.sourcePath + ".lock", "utf8"), staleLock);
    assert.equal(await readFile(orphanTemp, "utf8"), "{partial");
    await assert.rejects(access(f.destinationPath), { code: "ENOENT" });
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("atomic report export publishes a complete file and leaves no temporary artifact", async () => {
  const f = await fixture();
  try {
    const report = { status: "PASS", summary: { critical: 0 }, findings: [] };
    const result = await exportPaperRecoveryReport({ report, filePath: f.reportPath, format: "json" });
    assert.equal(result.status, "REPORT_EXPORTED");
    assert.deepEqual(JSON.parse(await readFile(f.reportPath, "utf8")), report);
    const files = await readdir(f.dir);
    assert.deepEqual(files.sort(), ["report.json"]);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("atomic report export collision preserves existing bytes and cleans temporary file", async () => {
  const f = await fixture();
  try {
    await writeFile(f.reportPath, "existing-evidence");
    await assert.rejects(exportPaperRecoveryReport({
      report: { status: "PASS", findings: [] }, filePath: f.reportPath, format: "json"
    }), { code: "EEXIST" });
    assert.equal(await readFile(f.reportPath, "utf8"), "existing-evidence");
    assert.deepEqual((await readdir(f.dir)).sort(), ["report.json"]);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
