import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistentPaperLedger } from "../src/paper/persistent-paper-ledger.js";

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "tradesys-ledger-"));
  const filePath = join(dir, "paper", "events.jsonl");
  return { dir, filePath };
}
const event = (eventId, payload = { symbol: "BTCUSDT", quantity: 0.1 }) =>
  ({ eventId, type: "ORDER_FILLED", timestamp: 1_800_000_000_000, payload });

test("persists events and recovers them after closing and reopening", async () => {
  const f = await fixture();
  try {
    let ledger = await createPersistentPaperLedger({ filePath: f.filePath });
    await ledger.append(event("fill_event_0001"));
    await ledger.close();
    ledger = await createPersistentPaperLedger({ filePath: f.filePath });
    const state = await ledger.snapshot();
    assert.equal(state.eventCount, 1);
    assert.equal(state.events[0].eventId, "fill_event_0001");
    await ledger.close();
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("serializes concurrent appends and preserves a valid hash chain", async () => {
  const f = await fixture();
  try {
    const ledger = await createPersistentPaperLedger({ filePath: f.filePath });
    await Promise.all(Array.from({ length: 20 }, (_, i) =>
      ledger.append(event("fill_event_" + String(i).padStart(4, "0"), { index: i }))));
    const state = await ledger.snapshot();
    assert.equal(state.eventCount, 20);
    assert.deepEqual(state.events.map((e) => e.sequence), Array.from({ length: 20 }, (_, i) => i + 1));
    await ledger.close();
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("same event id and same content is idempotent", async () => {
  const f = await fixture();
  try {
    const ledger = await createPersistentPaperLedger({ filePath: f.filePath });
    const input = event("fill_event_0002");
    const first = await ledger.append(input);
    const second = await ledger.append(input);
    assert.deepEqual(first, second);
    assert.equal((await ledger.snapshot()).eventCount, 1);
    await ledger.close();
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("rejects event id reuse with different content and invalid event types", async () => {
  const f = await fixture();
  try {
    const ledger = await createPersistentPaperLedger({ filePath: f.filePath });
    await ledger.append(event("fill_event_0003"));
    await assert.rejects(ledger.append(event("fill_event_0003", { quantity: 9 })), /different content/);
    await assert.rejects(ledger.append({ ...event("bad_event_0001"), type: "LIVE_ORDER" }), /unsupported/);
    await ledger.close();
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("detects tampering or truncated malformed records on recovery", async () => {
  const f = await fixture();
  try {
    const ledger = await createPersistentPaperLedger({ filePath: f.filePath });
    await ledger.append(event("fill_event_0004"));
    await ledger.close();
    const content = await readFile(f.filePath, "utf8");
    const tampered = content.replace("BTCUSDT", "ETHUSDT");
    await writeFile(f.filePath, tampered);
    await assert.rejects(createPersistentPaperLedger({ filePath: f.filePath }), /checksum mismatch/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("rejects appends after close and invalid timestamps", async () => {
  const f = await fixture();
  try {
    const ledger = await createPersistentPaperLedger({ filePath: f.filePath });
    await ledger.close();
    await assert.rejects(ledger.append(event("fill_event_0005")), /closed/);
    const reopened = await createPersistentPaperLedger({ filePath: f.filePath });
    await assert.rejects(reopened.append({ ...event("fill_event_0006"), timestamp: -1 }), /timestamp/);
    await reopened.close();
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});


test("holds an exclusive process lock until close and releases it for the next owner", async () => {
  const f = await fixture();
  try {
    const first = await createPersistentPaperLedger({ filePath: f.filePath });
    await assert.rejects(
      createPersistentPaperLedger({ filePath: f.filePath }),
      /locked by another process/
    );
    await first.close();
    const second = await createPersistentPaperLedger({ filePath: f.filePath });
    await second.append(event("fill_event_lock_01"));
    await second.close();
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("fails closed on a pre-existing lock instead of silently stealing it", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.dir, "paper"), { recursive: true });
    await writeFile(f.filePath + ".lock", JSON.stringify({
      token: "unknown-owner", pid: 12345, createdAt: 1
    }));
    await assert.rejects(
      createPersistentPaperLedger({ filePath: f.filePath }),
      /stale lock; manual review required/
    );
    const lock = JSON.parse(await readFile(f.filePath + ".lock", "utf8"));
    assert.equal(lock.token, "unknown-owner");
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});


test("fails closed on a crash-truncated JSONL tail and releases the acquired lock", async () => {
  const f = await fixture();
  try {
    const ledger = await createPersistentPaperLedger({ filePath: f.filePath });
    await ledger.append(event("fill_event_crash_01"));
    await ledger.close();
    await writeFile(f.filePath, (await readFile(f.filePath, "utf8")) + '{"sequence":2,"eventId":');
    await assert.rejects(
      createPersistentPaperLedger({ filePath: f.filePath }),
      /not newline-terminated/
    );
    await assert.rejects(
      readFile(f.filePath + ".lock", "utf8"),
      { code: "ENOENT" }
    );
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});


test("rejects a complete-looking final JSON record without its newline delimiter", async () => {
  const f = await fixture();
  try {
    const ledger = await createPersistentPaperLedger({ filePath: f.filePath });
    await ledger.append(event("fill_event_crash_02"));
    await ledger.close();
    const content = await readFile(f.filePath, "utf8");
    await writeFile(f.filePath, content.slice(0, -1));
    await assert.rejects(
      createPersistentPaperLedger({ filePath: f.filePath }),
      /not newline-terminated/
    );
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});


test("exclusive ledger lock is enforced across separate Node.js processes", async () => {
  const f = await fixture();
  const moduleUrl = new URL("../src/paper/persistent-paper-ledger.js", import.meta.url).href;
  const script = [
    'const { createPersistentPaperLedger } = await import(' + JSON.stringify(moduleUrl) + ');',
    'const ledger = await createPersistentPaperLedger({ filePath: process.argv[1] });',
    'process.stdout.write("READY\\n");',
    'process.stdin.once("data", async () => { await ledger.close(); process.exit(0); });'
  ].join("\n");
  let child;
  try {
    child = spawn(process.execPath, ["--input-type=module", "-e", script, f.filePath], {
      cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"]
    });
    const ready = await Promise.race([
      once(child.stdout, "data"),
      once(child, "exit").then(([code]) => { throw new Error("lock-holder child exited early: " + code); })
    ]);
    assert.match(String(ready[0]), /READY/);
    await assert.rejects(
      createPersistentPaperLedger({ filePath: f.filePath }),
      /locked by another process/
    );
    child.stdin.write("close\n");
    const [code] = await once(child, "exit");
    assert.equal(code, 0);
    const reopened = await createPersistentPaperLedger({ filePath: f.filePath });
    await reopened.close();
  } finally {
    if (child && child.exitCode === null) child.kill("SIGKILL");
    await rm(f.dir, { recursive: true, force: true });
  }
});
