import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const launcher = resolve("scripts/start-binance-spot-dashboard.js");

function run(args) {
  return spawnSync(process.execPath, [launcher, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10_000
  });
}

test("CLI launcher --help exits successfully without starting a runtime", () => {
  const result = run(["--help"]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /PAPER_ONLY/);
  assert.match(result.stdout, /never submits exchange orders/);
});

test("CLI launcher rejects missing ledger before runtime startup", () => {
  const result = run([]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--ledger is required/);
  assert.doesNotMatch(result.stdout + result.stderr, /Dashboard: http/);
});

test("CLI launcher rejects a public bind before creating ledger files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tradesys-cli-integration-"));
  const ledger = join(dir, "paper-ledger.jsonl");
  try {
    const result = run(["--ledger", ledger, "--host", "0.0.0.0"]);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /loopback|public interfaces/);
    await assert.rejects(access(ledger), { code: "ENOENT" });
    await assert.rejects(access(ledger + ".lock"), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI launcher rejects unknown options without creating a ledger", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tradesys-cli-integration-"));
  const ledger = join(dir, "paper-ledger.jsonl");
  try {
    const result = run(["--ledger", ledger, "--unknown"]);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown option/);
    await assert.rejects(access(ledger), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
