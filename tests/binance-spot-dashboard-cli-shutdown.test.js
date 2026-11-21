import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("CLI SIGTERM performs graceful paper-session shutdown and releases the ledger lock", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "tradesys-cli-shutdown-"));
  const ledger = join(dir, "paper-ledger.jsonl");
  const child = spawn(process.execPath, [
    resolve("scripts/start-binance-spot-dashboard.js"),
    "--ledger", ledger,
    "--port", "0",
    "--symbols", "BTCUSDT"
  ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });

  try {
    await new Promise((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => rejectReady(new Error("CLI did not become ready: " + stderr)), 10_000);
      const check = () => {
        if (stdout.includes("Mode:      PAPER_ONLY")) {
          clearTimeout(timeout);
          resolveReady();
        }
      };
      child.stdout.on("data", check);
      child.once("error", error => { clearTimeout(timeout); rejectReady(error); });
      child.once("exit", (code, signal) => {
        if (!stdout.includes("Mode:      PAPER_ONLY")) {
          clearTimeout(timeout);
          rejectReady(new Error("CLI exited before ready (code=" + code + ", signal=" + signal + "): " + stderr));
        }
      });
      check();
    });

    child.kill("SIGTERM");
    const exit = await new Promise((resolveExit, rejectExit) => {
      const timeout = setTimeout(() => rejectExit(new Error("CLI did not exit after SIGTERM")), 10_000);
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        resolveExit({ code, signal });
      });
    });
    assert.equal(exit.code, 0, stderr);
    assert.match(stdout, /Paper dashboard stopped cleanly/);
    const contents = await readFile(ledger, "utf8");
    assert.match(contents, /SESSION_STOPPED/);
    assert.doesNotMatch(contents, /ORDER_SUBMITTED/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await rm(dir, { recursive: true, force: true });
  }
});
