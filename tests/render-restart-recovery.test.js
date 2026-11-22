/**
 * Render restart/deploy recovery (2026-11-22 incident):
 *  - `npm run` did not forward SIGTERM through `sh -c`, so Node was killed
 *    without releasing the ledger lock on every restart or deploy.
 *  - The next container (different hostname) then refused to start.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistentPaperLedger, readContainerStartedAtMs } from "../src/paper/persistent-paper-ledger.js";
import { parseBinanceSpotDashboardCliArgs } from "../src/paper/binance-spot-dashboard-cli-config.js";

const root = new URL("..", import.meta.url).pathname;
const hasProc = (await readContainerStartedAtMs()) !== null;
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "tradesys-render-"));
  const filePath = join(dir, "data", "paper-ledger.jsonl");
  await mkdir(join(dir, "data"), { recursive: true });
  return { dir, filePath };
}
const exists = path => access(path).then(() => true, () => false);

test("exclusive volume reclaims a lock created before this container started (legacy format)", async () => {
  const f = await fixture();
  try {
    const legacy = JSON.stringify({ token: "previous-container", pid: 7, createdAt: 1_000_000 }) + "\n";
    await writeFile(f.filePath + ".lock", legacy);
    // Default policy: still fail-closed.
    await assert.rejects(createPersistentPaperLedger({ filePath: f.filePath }), /manual review required/);
    const ledger = await createPersistentPaperLedger({
      filePath: f.filePath, exclusiveVolume: true, containerStartedAtMs: async () => 2_000_000
    });
    assert.equal(ledger.reclaimedStaleLock.pid, 7);
    await ledger.close();
    assert.equal(await exists(f.filePath + ".lock"), false);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("exclusive volume never reclaims a lock created after this container started, or when unprovable", async () => {
  const f = await fixture();
  try {
    const cases = [
      [{ token: "same-container", pid: 7, createdAt: 2_500_000 }, async () => 2_000_000],
      [{ token: "within-clock-margin", pid: 7, createdAt: 1_999_000 }, async () => 2_000_000],
      [{ token: "no-proc", pid: 7, createdAt: 1 }, async () => null],
      [{ token: "no-created-at", pid: 7 }, async () => 2_000_000]
    ];
    for (const [lock, containerStartedAtMs] of cases) {
      await writeFile(f.filePath + ".lock", JSON.stringify(lock));
      await assert.rejects(createPersistentPaperLedger({
        filePath: f.filePath, exclusiveVolume: true, containerStartedAtMs
      }), /manual review required/, lock.token);
      assert.equal(JSON.parse(await readFile(f.filePath + ".lock", "utf8")).token, lock.token);
    }
    // A live holder in this process is never stolen, even under the policy.
    await rm(f.filePath + ".lock");
    const holder = await createPersistentPaperLedger({ filePath: f.filePath, exclusiveVolume: true });
    await assert.rejects(createPersistentPaperLedger({ filePath: f.filePath, exclusiveVolume: true }), /locked by another process/);
    await holder.close();
    await assert.rejects(createPersistentPaperLedger({ filePath: f.filePath, exclusiveVolume: "yes" }), /boolean/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test("readContainerStartedAtMs returns a past wall-clock time on Linux", { skip: !hasProc && "requires /proc" }, async () => {
  const startedAt = await readContainerStartedAtMs();
  assert.ok(startedAt > Date.UTC(2000, 0, 1));
  assert.ok(startedAt <= Date.now() + 1_000);
});

test("CLI enables the exclusive-volume policy with --exclusive-volume or automatically on Render", () => {
  const saved = process.env.RENDER;
  try {
    delete process.env.RENDER;
    assert.equal(parseBinanceSpotDashboardCliArgs(["--ledger", "./x.jsonl"]).exclusiveVolume, false);
    assert.equal(parseBinanceSpotDashboardCliArgs(["--ledger", "./x.jsonl", "--exclusive-volume"]).exclusiveVolume, true);
    process.env.RENDER = "true";
    assert.equal(parseBinanceSpotDashboardCliArgs(["--ledger", "./x.jsonl"]).exclusiveVolume, true);
  } finally {
    if (saved === undefined) delete process.env.RENDER; else process.env.RENDER = saved;
  }
});

async function startViaNpm(filePath, env = {}) {
  const child = spawn("npm", ["run", "--silent", "start:dashboard", "--", "--ledger", filePath, "--port", "0"], {
    cwd: root, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const ready = await Promise.race([
    (async () => { while (!/is running/.test(output)) await new Promise(r => setTimeout(r, 50)); return true; })(),
    once(child, "exit").then(([code]) => { throw new Error("dashboard exited early (" + code + "): " + output); }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("dashboard start timeout: " + output)), 15_000))
  ]);
  assert.equal(ready, true);
  return { child, output: () => output };
}

test("SIGTERM to `npm run start:dashboard` (as Render sends it) shuts down cleanly and releases the lock", { skip: process.platform === "win32" }, async () => {
  const f = await fixture();
  let child;
  try {
    const started = await startViaNpm(f.filePath);
    child = started.child;
    assert.equal(await exists(f.filePath + ".lock"), true);
    child.kill("SIGTERM");
    await once(child, "exit");
    // npm may exit before its child finishes; wait for the lock release.
    for (let i = 0; i < 50 && await exists(f.filePath + ".lock"); i++) await new Promise(r => setTimeout(r, 100));
    assert.match(started.output(), /Shutting down paper dashboard/);
    assert.equal(await exists(f.filePath + ".lock"), false);
    const ledger = await createPersistentPaperLedger({ filePath: f.filePath });
    assert.equal((await ledger.snapshot()).events.at(-1).type, "SESSION_STOPPED");
    await ledger.close();
  } finally {
    if (child && child.exitCode === null) child.kill("SIGKILL");
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("a new Render container starts despite a lock left by a killed previous container", { skip: !hasProc && "requires /proc" }, async () => {
  const f = await fixture();
  let child;
  try {
    // Lock in the pre-fix format, written long before this container started.
    await writeFile(f.filePath + ".lock", JSON.stringify({ token: "killed-container", pid: 7, createdAt: 1_000 }) + "\n");
    const started = await startViaNpm(f.filePath, { RENDER: "true" });
    child = started.child;
    const lock = JSON.parse(await readFile(f.filePath + ".lock", "utf8"));
    assert.notEqual(lock.token, "killed-container");
    child.kill("SIGTERM");
    await once(child, "exit");
  } finally {
    if (child && child.exitCode === null) child.kill("SIGKILL");
    await rm(f.dir, { recursive: true, force: true });
  }
});
