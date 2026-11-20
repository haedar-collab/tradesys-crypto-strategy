import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistentPaperLedger, verifyPaperLedger } from "../src/paper/persistent-paper-ledger.js";
import { migrateLegacyPaperLedger } from "../src/paper/legacy-paper-ledger-migration.js";

const config = { mode: "PAPER_ONLY", initialCash: 10_000, feeBps: 10, slippageBps: 5,
  maxQuoteAgeMs: 5_000, riskMarkMaxAgeMs: 60_000, dailyLossLimitPct: 3, maxDrawdownPct: 10, maxExposurePct: 80 };
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "tradesys-legacy-migration-"));
  return { dir, sourcePath: join(dir, "legacy.jsonl"), destinationPath: join(dir, "migrated.jsonl") };
}

test("migrates a verified legacy ledger to a new file and preserves the source byte-for-byte", async () => {
  const f = await fixture();
  try {
    const ledger = await createPersistentPaperLedger({ filePath: f.sourcePath });
    await ledger.append({ eventId: "legacy_event_01", type: "RISK_EVENT", timestamp: 1_700_000_000_000, payload: { state: { halted: false } } });
    await ledger.close();
    const original = await readFile(f.sourcePath, "utf8");
    const result = await migrateLegacyPaperLedger({ ...f, config, migrationTimestamp: 1_800_000_000_000 });
    assert.equal(result.status, "MIGRATED_COPY_CREATED");
    assert.equal(await readFile(f.sourcePath, "utf8"), original);
    const migrated = verifyPaperLedger(await readFile(f.destinationPath, "utf8"));
    assert.equal(migrated.events.length, 2);
    assert.equal(migrated.events[0].type, "SESSION_STARTED");
    assert.deepEqual(migrated.events[0].payload.config, config);
    assert.equal(migrated.events[0].payload.migration.sourceEventCount, 1);
    assert.equal(migrated.events[1].eventId, "legacy_event_01");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("refuses to migrate when configuration is incomplete", async () => {
  const f = await fixture();
  try {
    await assert.rejects(migrateLegacyPaperLedger({ ...f, config: { mode: "PAPER_ONLY", initialCash: 10_000 } }), /complete explicit PAPER_ONLY/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("refuses a source ledger that already has a session header", async () => {
  const f = await fixture();
  try {
    const ledger = await createPersistentPaperLedger({ filePath: f.sourcePath });
    await ledger.append({ eventId: "session_start_01", type: "SESSION_STARTED", timestamp: 1_700_000_000_000, payload: { config } });
    await ledger.close();
    await assert.rejects(migrateLegacyPaperLedger({ ...f, config }), /already has a session header/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("refuses to overwrite an existing destination", async () => {
  const f = await fixture();
  try {
    const ledger = await createPersistentPaperLedger({ filePath: f.sourcePath });
    await ledger.append({ eventId: "legacy_event_02", type: "RISK_EVENT", timestamp: 1_700_000_000_000, payload: { state: { halted: false } } });
    await ledger.close();
    await writeFile(f.destinationPath, "keep-me");
    await assert.rejects(migrateLegacyPaperLedger({ ...f, config }), /EEXIST/);
    assert.equal(await readFile(f.destinationPath, "utf8"), "keep-me");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("refuses a source ledger with an existing or stale lock", async () => {
  const f = await fixture();
  try {
    await writeFile(f.sourcePath, "");
    await writeFile(f.sourcePath + ".lock", JSON.stringify({ token: "stale" }));
    await assert.rejects(migrateLegacyPaperLedger({ ...f, config }), /source ledger is locked or has a stale lock/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("rejects a corrupt legacy hash chain without creating a destination", async () => {
  const f = await fixture();
  try {
    const ledger = await createPersistentPaperLedger({ filePath: f.sourcePath });
    await ledger.append({ eventId: "legacy_event_03", type: "RISK_EVENT", timestamp: 1_700_000_000_000, payload: { state: { halted: false } } });
    await ledger.close();
    await writeFile(f.sourcePath, (await readFile(f.sourcePath, "utf8")).replace("halted", "broken"));
    await assert.rejects(migrateLegacyPaperLedger({ ...f, config }), /checksum mismatch/);
    await assert.rejects(readFile(f.destinationPath, "utf8"), { code: "ENOENT" });
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
