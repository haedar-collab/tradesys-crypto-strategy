import { open, readFile, stat, access, link, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { verifyPaperLedger } from "./persistent-paper-ledger.js";
import { prepareLegacyPaperLedgerMigration, validateLegacyMigrationConfig } from "./legacy-paper-ledger-migration.js";

/**
 * Read-only ledger preflight. A present lock is reported, never removed.
 */
export async function inspectPaperLedgerFile({ filePath } = {}) {
  if (typeof filePath !== "string" || !filePath.trim()) throw new TypeError("filePath is required");
  const path = resolve(filePath);
  const [raw, metadata] = await Promise.all([readFile(path, "utf8"), stat(path)]);
  const verified = verifyPaperLedger(raw);
  let lock = { present: false, metadata: null };
  try {
    const lockRaw = await readFile(path + ".lock", "utf8");
    let parsed = null;
    try { parsed = JSON.parse(lockRaw); } catch { /* malformed lock remains present and blocks */ }
    lock = { present: true, metadata: parsed && {
      pid: Number.isSafeInteger(parsed.pid) ? parsed.pid : null,
      createdAt: Number.isSafeInteger(parsed.createdAt) ? parsed.createdAt : null,
      purpose: typeof parsed.purpose === "string" ? parsed.purpose : null
    } };
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const headerPresent = verified.events[0]?.type === "SESSION_STARTED";
  const unsupportedTypes = [...new Set(verified.events.map(event => event.type)
    .filter(type => !["SESSION_STARTED", "ORDER_SUBMITTED", "ORDER_FILLED", "ORDER_REJECTED", "POSITION_MARKED", "RISK_EVENT", "SESSION_STOPPED"].includes(type)))];
  return Object.freeze({
    status: lock.present ? "LOCKED_OR_STALE" : headerPresent ? "HEADERED_LEDGER" : "LEGACY_LEDGER",
    filePath: path, byteLength: metadata.size, eventCount: verified.events.length,
    firstEventType: verified.events[0]?.type ?? null, lastEventType: verified.events.at(-1)?.type ?? null,
    lastHash: verified.lastHash, lock, unsupportedTypes: Object.freeze(unsupportedTypes),
    migrationEligibleByStructure: !lock.present && !headerPresent && unsupportedTypes.length === 0
  });
}

/**
 * Deterministic preview: no lock acquisition, directory creation, or file writes.
 * Actual migration rechecks all conditions under its exclusive source lock.
 */
export async function dryRunLegacyPaperLedgerMigration({ sourcePath, destinationPath, config, migrationTimestamp = Date.now() } = {}) {
  if (typeof sourcePath !== "string" || !sourcePath.trim() ||
      typeof destinationPath !== "string" || !destinationPath.trim()) {
    throw new TypeError("sourcePath and destinationPath are required");
  }
  validateLegacyMigrationConfig(config);
  const source = resolve(sourcePath), destination = resolve(destinationPath);
  if (source === destination) throw new Error("migration destination must differ from source ledger");
  try { await access(destination); throw new Error("migration destination already exists"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  try { await access(source + ".lock"); throw new Error("source ledger is locked or has a stale lock; manual review required"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const plan = prepareLegacyPaperLedgerMigration({ raw: await readFile(source, "utf8"), config, migrationTimestamp });
  return Object.freeze({
    status: "DRY_RUN_VALID", writesPerformed: false, sourcePath: source, destinationPath: destination,
    sourceSha256: plan.sourceSha256, sourceEventCount: plan.sourceEventCount,
    migratedEventCount: plan.migratedEventCount, lastHash: plan.lastHash,
    outputByteLength: Buffer.byteLength(plan.output, "utf8"),
    note: "Preview only. Source/destination lock and collision checks are repeated during actual migration."
  });
}

export function formatPaperRecoveryReport(report, { format = "text" } = {}) {
  if (!report || typeof report !== "object" || Array.isArray(report)) throw new TypeError("report object is required");
  if (format === "json") return JSON.stringify(report, null, 2) + "\n";
  if (format !== "text") throw new RangeError("format must be text or json");
  const lines = [
    "PAPER RECOVERY REPORT",
    "Status: " + (report.status ?? "UNKNOWN"),
    "Summary: " + JSON.stringify(report.summary ?? {}),
    "Findings: " + (Array.isArray(report.findings) ? report.findings.length : 0)
  ];
  for (const item of report.findings ?? []) {
    lines.push("- [" + (item.severity ?? "UNKNOWN") + "] " + (item.code ?? "UNSPECIFIED") + ": " +
      (item.message ?? "") + (item.reference == null ? "" : " | reference=" + JSON.stringify(item.reference)) +
      (item.action ? " | action=" + item.action : ""));
  }
  return lines.join("\n") + "\n";
}

/**
 * Export a report with no-overwrite semantics. This is an audit artifact only;
 * it does not modify or certify the source ledger.
 */
export async function exportPaperRecoveryReport({ report, filePath, format = "json" } = {}) {
  if (typeof filePath !== "string" || !filePath.trim()) throw new TypeError("filePath is required");
  const path = resolve(filePath);
  const content = formatPaperRecoveryReport(report, { format });
  const tempPath = path + ".export-" + randomUUID() + ".tmp";
  let tempCreated = false;
  try {
    const handle = await open(tempPath, "wx", 0o600);
    tempCreated = true;
    try { await handle.writeFile(content, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    // Hard-link publication is atomic and fails if the destination already exists.
    await link(tempPath, path);
    await unlink(tempPath);
    tempCreated = false;
  } finally {
    if (tempCreated) await unlink(tempPath).catch(() => {});
  }
  return Object.freeze({ status: "REPORT_EXPORTED", filePath: path, format, byteLength: Buffer.byteLength(content, "utf8") });
}


/**
 * Read-only backup verification. It checks stable reads, ledger hash chains,
 * and byte-for-byte SHA-256 equality. A present lock yields REVIEW because
 * the caller cannot assume the source was quiescent when copied.
 */
export async function verifyPaperLedgerBackup({ sourcePath, backupPath } = {}) {
  if (typeof sourcePath !== "string" || !sourcePath.trim() ||
      typeof backupPath !== "string" || !backupPath.trim()) {
    throw new TypeError("sourcePath and backupPath are required");
  }
  const source = resolve(sourcePath), backup = resolve(backupPath);
  if (source === backup) throw new Error("source and backup paths must differ");

  async function stableRead(path) {
    const before = await stat(path);
    const raw = await readFile(path);
    const after = await stat(path);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
        before.ino !== after.ino || raw.length !== after.size) {
      throw new Error("file changed while being verified: " + path);
    }
    return raw;
  }
  async function lockPresent(path) {
    try { await access(path + ".lock"); return true; }
    catch (error) { if (error.code === "ENOENT") return false; throw error; }
  }

  const [sourceRaw, backupRaw, sourceLocked, backupLocked] = await Promise.all([
    stableRead(source), stableRead(backup), lockPresent(source), lockPresent(backup)
  ]);
  const sourceSha256 = createHash("sha256").update(sourceRaw).digest("hex");
  const backupSha256 = createHash("sha256").update(backupRaw).digest("hex");
  let sourceLedgerValid = false, backupLedgerValid = false;
  let sourceEventCount = null, backupEventCount = null;
  let sourceLedgerError = null, backupLedgerError = null;
  try { sourceEventCount = verifyPaperLedger(sourceRaw.toString("utf8")).events.length; sourceLedgerValid = true; }
  catch (error) { sourceLedgerError = error.message; }
  try { backupEventCount = verifyPaperLedger(backupRaw.toString("utf8")).events.length; backupLedgerValid = true; }
  catch (error) { backupLedgerError = error.message; }
  const byteIdentical = sourceSha256 === backupSha256 && sourceRaw.length === backupRaw.length;
  const status = !sourceLedgerValid || !backupLedgerValid ? "INVALID" :
    !byteIdentical ? "MISMATCH" : sourceLocked || backupLocked ? "REVIEW" : "PASS";
  return Object.freeze({
    status, sourcePath: source, backupPath: backup,
    sourceSha256, backupSha256, sourceByteLength: sourceRaw.length,
    backupByteLength: backupRaw.length, sourceEventCount, backupEventCount,
    sourceLedgerValid, backupLedgerValid, byteIdentical, sourceLocked, backupLocked,
    sourceLedgerError, backupLedgerError,
    note: "Read-only verification only. PASS confirms byte identity and valid local hash chains; it does not prove external execution truth or storage durability."
  });
}
