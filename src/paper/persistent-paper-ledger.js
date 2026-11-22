import { link, mkdir, open, readFile, rename, truncate, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { hostname } from "node:os";
import { createHash, randomUUID } from "node:crypto";

const GENESIS = "0".repeat(64);
export const PAPER_LEDGER_EVENT_TYPES = Object.freeze(["SESSION_STARTED","ORDER_SUBMITTED","ORDER_FILLED","ORDER_REJECTED","POSITION_MARKED","RISK_EVENT","OPERATOR_REVIEW_RESOLVED","SESSION_STOPPED"]);
const TYPES = new Set(PAPER_LEDGER_EVENT_TYPES);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => JSON.stringify(value);
const clone = (value) => structuredClone(value);

function validateEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("event object is required");
  if (typeof input.eventId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(input.eventId)) throw new TypeError("eventId must be 8-80 safe characters");
  if (!TYPES.has(input.type)) throw new RangeError("unsupported ledger event type");
  if (!Number.isSafeInteger(input.timestamp) || input.timestamp < 0) throw new TypeError("timestamp must be UTC epoch milliseconds");
  if (!input.payload || typeof input.payload !== "object" || Array.isArray(input.payload)) throw new TypeError("payload object is required");
}

function verifyLines(text) {
  if (text.length > 0 && !text.endsWith("\n")) {
    throw new Error("ledger final record is not newline-terminated; manual recovery required");
  }
  const rows = text.split("\n").filter(Boolean);
  let previousHash = GENESIS;
  const ids = new Set();
  const events = [];
  for (let i = 0; i < rows.length; i++) {
    let row;
    try { row = JSON.parse(rows[i]); } catch { throw new Error("ledger contains invalid JSON at line " + (i + 1)); }
    const { hash: storedHash, ...body } = row;
    if (body.sequence !== i + 1) throw new Error("ledger sequence is invalid at line " + (i + 1) + ": expected " + (i + 1) + ", received " + body.sequence);
    if (body.previousHash !== previousHash) throw new Error("ledger hash-chain link is invalid at line " + (i + 1) + ": expected " + previousHash + ", received " + body.previousHash);
    if (typeof body.eventId !== "string" || ids.has(body.eventId)) throw new Error("ledger contains duplicate or invalid eventId at line " + (i + 1));
    if (storedHash !== hash(canonical(body))) throw new Error("ledger checksum mismatch at line " + (i + 1));
    ids.add(body.eventId);
    previousHash = storedHash;
    events.push(row);
  }
  return { events, ids, lastHash: previousHash };
}

async function readText(path) {
  try { return (await readFile(path, "utf8")).trim(); } catch { return null; }
}

/**
 * Identity of a running process that survives PID reuse: Linux boot id plus the
 * process start time (clock ticks since boot). Inside containers PIDs are
 * routinely reused across restarts (e.g. pid 7 every time), so a PID alone can
 * never prove that a lock owner is dead. Returns null where /proc is unavailable.
 */
async function processIdentity(pid) {
  const [bootId, stat] = await Promise.all([
    readText("/proc/sys/kernel/random/boot_id"),
    readText("/proc/" + pid + "/stat")
  ]);
  if (!bootId || !stat) return null;
  // Field 22 (starttime); fields after the parenthesised command name start at field 3.
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const startTime = fields[19];
  return /^\d+$/.test(startTime) ? { bootId, startTime } : null;
}

/**
 * Wall-clock start time of this container's init process (PID 1), derived from
 * the kernel boot time and PID 1's start ticks. Linux exposes start times in
 * USER_HZ, which is fixed at 100 for the userspace ABI. Returns null when /proc
 * is unavailable, which keeps the exclusive-volume rule fail-closed.
 */
export async function readContainerStartedAtMs() {
  const [stat, init] = await Promise.all([readText("/proc/stat"), readText("/proc/1/stat")]);
  const btime = stat?.match(/^btime (\d+)$/m)?.[1];
  const fields = init ? init.slice(init.lastIndexOf(")") + 2).split(" ") : [];
  const ticks = fields[19];
  if (!btime || !/^\d+$/.test(ticks ?? "")) return null;
  return Number(btime) * 1000 + Number(ticks) * 10;
}

const EXCLUSIVE_VOLUME_CLOCK_MARGIN_MS = 2_000;

/**
 * Decide whether an existing lock was provably left behind by a dead process.
 * Only locks written by this module with a full process identity on the same
 * host can be reclaimed; anything else (legacy, malformed, foreign host, no
 * /proc) stays fail-closed for operator review.
 */
async function isProvablyStaleLock(lock, { exclusiveVolume = false, containerStartedAtMs = readContainerStartedAtMs } = {}) {
  // Exclusive volume (e.g. a Render persistent disk, which can be attached to
  // only one running instance): a lock created before this container started
  // was necessarily written by a previous, now-dead container. This also
  // covers legacy lock formats and locks from another instance hostname.
  if (exclusiveVolume && lock && typeof lock === "object" &&
      Number.isSafeInteger(lock.createdAt) && lock.createdAt > 0) {
    const startedAt = await containerStartedAtMs();
    if (Number.isFinite(startedAt) && lock.createdAt < startedAt - EXCLUSIVE_VOLUME_CLOCK_MARGIN_MS) return true;
  }
  if (!lock || typeof lock !== "object" || typeof lock.token !== "string" ||
      !Number.isSafeInteger(lock.pid) || lock.pid <= 0 ||
      typeof lock.hostname !== "string" || typeof lock.bootId !== "string" ||
      typeof lock.processStartTime !== "string") return false;
  if (lock.hostname !== hostname()) return false;
  const currentBootId = await readText("/proc/sys/kernel/random/boot_id");
  if (!currentBootId) return false;
  if (currentBootId !== lock.bootId) return true; // machine/container kernel rebooted
  const live = await processIdentity(lock.pid);
  if (live === null) {
    // Same boot: the owner is dead only if the PID no longer exists at all.
    try { process.kill(lock.pid, 0); return false; }
    catch (error) { return error.code === "ESRCH"; }
  }
  return live.startTime !== lock.processStartTime; // PID reused by another process
}

/**
 * Append-only, hash-chained JSONL ledger. Each append is serialized and fsynced.
 * It stores supplied paper-trading events; it does not execute orders.
 */
export async function createPersistentPaperLedger({
  filePath,
  exclusiveVolume = false,
  containerStartedAtMs = readContainerStartedAtMs
} = {}) {
  if (typeof exclusiveVolume !== "boolean") throw new TypeError("exclusiveVolume must be a boolean");
  if (typeof containerStartedAtMs !== "function") throw new TypeError("containerStartedAtMs must be a function");
  if (typeof filePath !== "string" || !filePath.trim()) throw new TypeError("filePath is required");
  const path = resolve(filePath);
  await mkdir(dirname(path), { recursive: true });

  // Exclusive lifetime lock: never allow two processes to append to the same
  // JSONL chain. Stale locks deliberately require operator review; auto-stealing
  // a lock could corrupt a ledger while its original writer is still alive.
  const lockPath = path + ".lock";
  const lockToken = randomUUID();
  const lockedMessage = "ledger is locked by another process or has a stale lock; manual review required";
  let lockHandle;
  let reclaimedStaleLock = null;
  try {
    lockHandle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    // A lock whose owner is provably dead (crash, OOM, SIGKILL, container
    // restart) is reclaimed; every other lock still requires manual review.
    let existing = null;
    try { existing = JSON.parse(await readFile(lockPath, "utf8")); } catch { existing = null; }
    if (!(await isProvablyStaleLock(existing, { exclusiveVolume, containerStartedAtMs }))) throw new Error(lockedMessage);
    const quarantine = lockPath + ".stale-" + randomUUID();
    try { await rename(lockPath, quarantine); }
    catch (renameError) {
      if (renameError.code === "ENOENT") throw new Error(lockedMessage);
      throw renameError;
    }
    // Guard against a concurrent starter that reclaimed first and wrote a new lock.
    let moved = null;
    try { moved = JSON.parse(await readFile(quarantine, "utf8")); } catch { moved = null; }
    if (moved?.token !== existing.token) {
      await link(quarantine, lockPath).catch(() => {});
      await unlink(quarantine).catch(() => {});
      throw new Error(lockedMessage);
    }
    await unlink(quarantine).catch(() => {});
    reclaimedStaleLock = Object.freeze({
      pid: existing.pid, createdAt: existing.createdAt ?? null, hostname: existing.hostname
    });
    try { lockHandle = await open(lockPath, "wx", 0o600); }
    catch (retryError) {
      if (retryError.code === "EEXIST") throw new Error(lockedMessage);
      throw retryError;
    }
  }
  try {
    const identity = await processIdentity(process.pid);
    await lockHandle.writeFile(JSON.stringify({
      token: lockToken, pid: process.pid, createdAt: Date.now(),
      hostname: hostname(),
      ...(identity ? { bootId: identity.bootId, processStartTime: identity.startTime } : {})
    }) + "\n", "utf8");
    await lockHandle.sync();
  } catch (error) {
    await lockHandle.close().catch(() => {});
    await unlink(lockPath).catch(() => {});
    throw error;
  }

  let lockReleased = false;
  async function releaseLock() {
    if (lockReleased) return;
    lockReleased = true;
    await lockHandle.close().catch(() => {});
    try {
      const current = JSON.parse(await readFile(lockPath, "utf8"));
      if (current.token === lockToken) await unlink(lockPath);
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
  }

  let raw;
  try { raw = await readFile(path, "utf8"); }
  catch (error) {
    if (error.code !== "ENOENT") {
      await releaseLock();
      throw error;
    }
    raw = "";
  }
  let recovered;
  try { recovered = verifyLines(raw); }
  catch (error) { await releaseLock(); throw error; }
  let sequence = recovered.events.length;
  let previousHash = recovered.lastHash;
  let committedBytes = Buffer.byteLength(raw, "utf8");
  const ids = recovered.ids;
  let queue = Promise.resolve();
  let closed = false;
  let poisoned = null;

  async function append(input) {
    const operation = queue.then(async () => {
      if (closed) throw new Error("ledger is closed");
      if (poisoned) {
        throw new Error("ledger is unavailable after a failed write; reopen it to re-verify the hash chain: " + poisoned.message);
      }
      validateEvent(input);
      if (ids.has(input.eventId)) {
        const existing = recovered.events.find((e) => e.eventId === input.eventId) ?? appended.find((e) => e.eventId === input.eventId);
        if (existing && existing.type === input.type && existing.timestamp === input.timestamp &&
            canonical(existing.payload) === canonical(input.payload)) return clone(existing);
        throw new Error("eventId already exists with different content");
      }
      const body = { sequence: sequence + 1, eventId: input.eventId, type: input.type,
        timestamp: input.timestamp, payload: clone(input.payload), previousHash };
      const entry = { ...body, hash: hash(canonical(body)) };
      const line = canonical(entry) + "\n";
      try {
        const handle = await open(path, "a", 0o600);
        try { await handle.writeFile(line, "utf8"); await handle.sync(); }
        finally { await handle.close(); }
      } catch (error) {
        // The write may have landed partially or fully without being durable.
        // Never advance in-memory state, roll the file back to the last
        // acknowledged record when possible, and refuse further appends so a
        // later write cannot extend a torn or unacknowledged chain.
        poisoned = error instanceof Error ? error : new Error(String(error));
        await truncate(path, committedBytes).catch(() => {});
        throw error;
      }
      committedBytes += Buffer.byteLength(line, "utf8");
      sequence++;
      previousHash = entry.hash;
      ids.add(input.eventId);
      appended.push(entry);
      return clone(entry);
    });
    queue = operation.catch(() => {});
    return operation;
  }
  const appended = [];
  async function close() { await queue; if (closed) return; closed = true; await releaseLock(); }
  async function snapshot() {
    await queue;
    const text = await readFile(path, "utf8").catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error));
    const verified = verifyLines(text);
    return Object.freeze({ status: "COMPLETE", eventCount: verified.events.length,
      lastSequence: verified.events.length, lastHash: verified.lastHash,
      events: Object.freeze(verified.events.map(clone)) });
  }
  return Object.freeze({
    append, snapshot, close, filePath: path,
    isPoisoned: () => poisoned !== null,
    reclaimedStaleLock
  });
}

export { verifyLines as verifyPaperLedger };
