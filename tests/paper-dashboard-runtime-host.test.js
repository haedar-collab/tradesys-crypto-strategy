import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPaperDashboardRuntimeHost } from "../src/paper/paper-dashboard-runtime-host.js";

test("runtime host starts a loopback dashboard without exposing session mutations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tradesys-dashboard-host-"));
  const filePath = join(dir, "paper-ledger.jsonl");
  const host = await startPaperDashboardRuntimeHost({ filePath, port: 0 });
  try {
    const address = host.address();
    assert.equal(address.address, "127.0.0.1");
    const page = await fetch("http://127.0.0.1:" + address.port + "/dashboard/");
    assert.equal(page.status, 200);
    const response = await fetch("http://127.0.0.1:" + address.port + "/api/paper-dashboard");
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.viewModel.mode, "PAPER_ONLY");
    assert.equal(payload.viewModel.market.state, "DISCONNECTED");
    assert.equal(payload.viewModel.permissions.maySubmitOrders, false);
    assert.equal(typeof host.submitMarketOrder, "undefined");
    assert.equal(typeof host.session, "undefined");
  } finally {
    await host.close();
    const ledger = await readFile(filePath, "utf8");
    assert.match(ledger, /SESSION_STOPPED/);
    await rm(dir, { recursive: true, force: true });
  }
});

test("runtime host rejects missing ledger path and non-paper mode", async () => {
  await assert.rejects(startPaperDashboardRuntimeHost(), /filePath/);
  const dir = await mkdtemp(join(tmpdir(), "tradesys-dashboard-host-"));
  try {
    await assert.rejects(
      startPaperDashboardRuntimeHost({ filePath: join(dir, "ledger.jsonl"), sessionOptions: { mode: "LIVE" } }),
      /PAPER_ONLY/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
