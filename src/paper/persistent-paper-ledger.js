import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

const GENESIS = "0".repeat(64);
const TYPES = new Set(["SESSION_STARTED","ORDER_SUBMITTED","ORDER_FILLED","ORDER_REJECTED","POSITION_MARKED","RISK_EVENT","SESSION_STOPPED"]);
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

/**
 * Append-only, hash-chained JSONL ledger. Each append is serialized and fsynced.
 * It stores supplied paper-trading events; it does not execute orders.
 */
export async function createPersistentPaperLedger({ filePath } = {}) {
  if (typeof filePath !== "string" || !filePath.trim()) throw new TypeError("filePath is required");
  const path = resolve(filePath);
  await mkdir(dirname(path), { recursive: true });
  let raw;
  try { raw = await readFile(path, "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; raw = ""; }
  const recovered = verifyLines(raw);
  let sequence = recovered.events.length;
  let previousHash = recovered.lastHash;
  const ids = recovered.ids;
  let queue = Promise.resolve();
  let closed = false;

  async function append(input) {
    const operation = queue.then(async () => {
      if (closed) throw new Error("ledger is closed");
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
      const handle = await open(path, "a", 0o600);
      try { await handle.writeFile(canonical(entry) + "\n", "utf8"); await handle.sync(); }
      finally { await handle.close(); }
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
  async function close() { await queue; closed = true; }
  async function snapshot() {
    await queue;
    const text = await readFile(path, "utf8").catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error));
    const verified = verifyLines(text);
    return Object.freeze({ status: "COMPLETE", eventCount: verified.events.length,
      lastSequence: verified.events.length, lastHash: verified.lastHash,
      events: Object.freeze(verified.events.map(clone)) });
  }
  return Object.freeze({ append, snapshot, close, filePath: path });
}

export { verifyLines as verifyPaperLedger };
