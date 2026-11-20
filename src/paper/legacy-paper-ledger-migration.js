import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, link, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { verifyPaperLedger } from "./persistent-paper-ledger.js";

const GENESIS = "0".repeat(64);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => JSON.stringify(value);
const TYPES = new Set(["ORDER_SUBMITTED", "ORDER_FILLED", "ORDER_REJECTED", "POSITION_MARKED", "RISK_EVENT", "SESSION_STOPPED"]);
const CONFIG_KEYS = ["mode", "initialCash", "feeBps", "slippageBps", "maxQuoteAgeMs", "riskMarkMaxAgeMs", "dailyLossLimitPct", "maxDrawdownPct", "maxExposurePct"];

function validateConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config) || config.mode !== "PAPER_ONLY" ||
      Object.keys(config).length !== CONFIG_KEYS.length || CONFIG_KEYS.some(key => !(key in config))) {
    throw new TypeError("complete explicit PAPER_ONLY session configuration is required");
  }
  if (!Number.isFinite(config.initialCash) || config.initialCash <= 0) throw new RangeError("initialCash must be positive");
  for (const key of ["feeBps", "slippageBps", "dailyLossLimitPct", "maxDrawdownPct", "maxExposurePct"]) {
    if (!Number.isFinite(config[key]) || config[key] < 0) throw new RangeError(key + " must be non-negative");
  }
  for (const key of ["maxQuoteAgeMs", "riskMarkMaxAgeMs"]) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 0) throw new RangeError(key + " must be a non-negative safe integer");
  }
  if (config.dailyLossLimitPct === 0 || config.maxDrawdownPct === 0 || config.maxExposurePct === 0) {
    throw new RangeError("risk limits must be greater than zero");
  }
}

/**
 * Pure migration planner shared by dry-run and execution. It performs no I/O.
 */
export function prepareLegacyPaperLedgerMigration({ raw, config, migrationTimestamp = Date.now() } = {}) {
  if (typeof raw !== "string") throw new TypeError("raw source ledger text is required");
  validateConfig(config);
  if (!Number.isSafeInteger(migrationTimestamp) || migrationTimestamp < 0) throw new TypeError("migrationTimestamp must be a UTC epoch millisecond integer");
  const verified = verifyPaperLedger(raw);
  if (verified.events.some(event => event.type === "SESSION_STARTED")) throw new Error("source ledger already has a session header; it is not a legacy ledger");
  for (const event of verified.events) {
    if (!TYPES.has(event.type) || typeof event.eventId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(event.eventId) ||
        !Number.isSafeInteger(event.timestamp) || !event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) {
      throw new Error("legacy ledger contains an unsupported or malformed event; migration aborted");
    }
  }
  const sourceSha256 = hash(raw);
  const migrationId = "legacy_migration_" + hash(sourceSha256 + canonical(config)).slice(0, 32);
  let previousHash = GENESIS;
  const migrated = [];
  const headerBody = { sequence: 1, eventId: migrationId, type: "SESSION_STARTED", timestamp: migrationTimestamp,
    payload: { config: structuredClone(config), migration: { formatVersion: 1, sourceSha256, sourceEventCount: verified.events.length, migratedAt: migrationTimestamp } },
    previousHash };
  const header = { ...headerBody, hash: hash(canonical(headerBody)) };
  migrated.push(header); previousHash = header.hash;
  for (const legacy of verified.events) {
    const body = { sequence: migrated.length + 1, eventId: legacy.eventId, type: legacy.type,
      timestamp: legacy.timestamp, payload: structuredClone(legacy.payload), previousHash };
    const row = { ...body, hash: hash(canonical(body)) };
    migrated.push(row); previousHash = row.hash;
  }
  const output = migrated.map(canonical).join("\n") + "\n";
  const check = verifyPaperLedger(output);
  if (check.events.length !== migrated.length || check.lastHash !== previousHash) throw new Error("planned migration verification failed");
  return Object.freeze({ output, sourceSha256, sourceEventCount: verified.events.length,
    migratedEventCount: check.events.length, lastHash: check.lastHash });
}

/**
 * Offline, copy-forward migration. The source is locked exclusively while read,
 * never modified, and the destination is created without overwrite semantics.
 */
export async function migrateLegacyPaperLedger({ sourcePath, destinationPath, config, migrationTimestamp = Date.now() } = {}) {
  if (typeof sourcePath !== "string" || !sourcePath.trim() || typeof destinationPath !== "string" || !destinationPath.trim()) {
    throw new TypeError("sourcePath and destinationPath are required");
  }
  validateConfig(config);
  if (!Number.isSafeInteger(migrationTimestamp) || migrationTimestamp < 0) throw new TypeError("migrationTimestamp must be a UTC epoch millisecond integer");
  const source = resolve(sourcePath), destination = resolve(destinationPath);
  if (source === destination) throw new Error("migration destination must differ from source ledger");
  const sourceLock = source + ".lock";
  const token = randomUUID();
  let lock;
  try { lock = await open(sourceLock, "wx", 0o600); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error("source ledger is locked or has a stale lock; manual review required");
    throw error;
  }
  let tempPath;
  try {
    await lock.writeFile(JSON.stringify({ token, pid: process.pid, createdAt: Date.now(), purpose: "LEGACY_LEDGER_MIGRATION" }) + "\n", "utf8");
    await lock.sync();
    const plan = prepareLegacyPaperLedgerMigration({ raw: await readFile(source, "utf8"), config, migrationTimestamp });
    await mkdir(dirname(destination), { recursive: true });
    tempPath = destination + ".migration-" + randomUUID() + ".tmp";
    const temp = await open(tempPath, "wx", 0o600);
    try { await temp.writeFile(plan.output, "utf8"); await temp.sync(); } finally { await temp.close(); }
    await link(tempPath, destination);
    await unlink(tempPath); tempPath = undefined;
    const check = verifyPaperLedger(await readFile(destination, "utf8"));
    if (check.events.length !== plan.migratedEventCount || check.lastHash !== plan.lastHash) throw new Error("migrated ledger verification failed");
    return Object.freeze({ status: "MIGRATED_COPY_CREATED", sourcePath: source, destinationPath: destination,
      sourceSha256: plan.sourceSha256, sourceEventCount: plan.sourceEventCount,
      migratedEventCount: check.events.length, lastHash: check.lastHash });
  } finally {
    if (tempPath) await unlink(tempPath).catch(() => {});
    await lock.close().catch(() => {});
    try { const current = JSON.parse(await readFile(sourceLock, "utf8")); if (current.token === token) await unlink(sourceLock); }
    catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
  }
}

export { validateConfig as validateLegacyMigrationConfig };
