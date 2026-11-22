import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistentPaperLedger } from "../src/paper/persistent-paper-ledger.js";
import { createPaperDashboardRuntimeSnapshot } from "../src/paper/paper-dashboard-runtime-adapter.js";

const event = (id, payload = { n: 1 }) => ({ eventId: id, type: "RISK_EVENT", timestamp: 1_800_000_000_000, payload });
async function tempLedger() {
  const dir = await mkdtemp(join(tmpdir(), "tradesys-perf-"));
  return { dir, filePath: join(dir, "events.jsonl") };
}

test("#8 snapshot is cached until the next append and events are deep-frozen", async () => {
  const f = await tempLedger();
  try {
    const ledger = await createPersistentPaperLedger({ filePath: f.filePath });
    await ledger.append(event("perf_event_0001", { nested: { value: 1 } }));
    const a = await ledger.snapshot();
    const b = await ledger.snapshot();
    assert.equal(a, b, "unchanged ledger returns the cached snapshot");
    assert.throws(() => { a.events[0].payload.nested.value = 2; }, TypeError);
    assert.throws(() => { a.events.push({}); }, TypeError);
    await ledger.append(event("perf_event_0002"));
    const c = await ledger.snapshot();
    assert.notEqual(c, a);
    assert.equal(c.eventCount, 2);
    assert.equal(a.eventCount, 1, "earlier snapshots are immutable views");
    assert.equal(c.lastHash, c.events[1].hash);
    await ledger.close();
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("#8 in-memory state matches a full re-verification, including after reopen", async () => {
  const f = await tempLedger();
  try {
    let ledger = await createPersistentPaperLedger({ filePath: f.filePath });
    for (let i = 0; i < 20; i++) await ledger.append(event("perf_event_" + String(i).padStart(4, "0"), { i }));
    const memory = await ledger.snapshot();
    assert.deepEqual(await ledger.verify(), { status: "VERIFIED", eventCount: 20, lastHash: memory.lastHash });
    await ledger.close();
    ledger = await createPersistentPaperLedger({ filePath: f.filePath });
    assert.deepEqual(await ledger.snapshot(), memory);
    await ledger.close();
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("#8 outside modification of the file is still detected (fail-closed)", async () => {
  const f = await tempLedger();
  try {
    const ledger = await createPersistentPaperLedger({ filePath: f.filePath });
    await ledger.append(event("perf_event_ext1"));
    // Same-size tampering is caught by verify(); size changes by every snapshot().
    const original = await readFile(f.filePath, "utf8");
    await writeFile(f.filePath, original.replace('"n":1', '"n":2'));
    await assert.rejects(ledger.verify(), /checksum mismatch|diverges/);
    await writeFile(f.filePath, original);
    await appendFile(f.filePath, '{"injected":true}\n');
    await assert.rejects(ledger.snapshot(), /changed outside this process/);
    await ledger.close();
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("#8 dashboard polls on a large ledger stay fast and reuse the performance report", async () => {
  const f = await tempLedger();
  const N = 50_000;
  let prev = "0".repeat(64), out = "";
  for (let i = 1; i <= N; i++) {
    const body = { sequence: i, eventId: "mark_" + String(i).padStart(10, "0"), type: "POSITION_MARKED",
      timestamp: 1e12 + i, payload: { cash: 5000, marketValue: 0, equity: 10_000 + (i % 50), unrealizedPnl: 0, marks: [] }, previousHash: prev };
    const h = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    out += JSON.stringify({ ...body, hash: h }) + "\n"; prev = h;
  }
  await writeFile(f.filePath, out);
  const ledger = await createPersistentPaperLedger({ filePath: f.filePath });
  try {
    const session = { snapshot: async () => ({ mode: "PAPER_ONLY", broker: { cash: 10_000, initialCash: 10_000, positions: [] }, ledger: await ledger.snapshot(), risk: null }) };
    const poll = () => createPaperDashboardRuntimeSnapshot({ session, now: () => 1e12 + N + 1 });
    const first = await poll();
    const started = performance.now();
    let last;
    for (let i = 0; i < 20; i++) last = await poll();
    const perPoll = (performance.now() - started) / 20;
    // Previously every poll re-read and re-hashed the whole file (~0.5 s here).
    assert.ok(perPoll < 50, "steady-state poll took " + perPoll.toFixed(1) + " ms");
    assert.equal(last.snapshot.performanceReport, first.snapshot.performanceReport, "report is cached per ledger version");
    assert.equal(last.snapshot.performanceReport.equityMarkCount, N);
  } finally {
    await ledger.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});
