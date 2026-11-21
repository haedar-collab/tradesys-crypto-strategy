import test from "node:test";
import assert from "node:assert/strict";
import { startPaperDashboardHttpServer } from "../src/paper/paper-dashboard-http-server.js";

const viewModel = {
  mode: "PAPER_ONLY",
  permissions: { readOnly: true, maySubmitOrders: false, mayMutateLedger: false, mayResetRisk: false },
  market: { state: "DISCONNECTED" }
};
const validSnapshot = () => ({
  schemaVersion: 1,
  generatedAt: 2000,
  source: { type: "IN_PROCESS_PAPER_SESSION", mode: "PAPER_ONLY", ledgerEventCount: 1, ledgerLastHash: "a".repeat(64) },
  snapshot: { ledgerSnapshot: { events: [{ secret: "must-not-leak" }] } },
  viewModel
});

async function withServer(options, run) {
  const server = createPaperDashboardHttpServer(options);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test("GET dashboard endpoint returns read-only projection without raw ledger", async () => {
  await withServer({ getSnapshot: async () => validSnapshot() }, async base => {
    const response = await fetch(base + "/api/paper-dashboard");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    const body = await response.json();
    assert.equal(body.viewModel.mode, "PAPER_ONLY");
    assert.equal(body.viewModel.permissions.maySubmitOrders, false);
    assert.equal(JSON.stringify(body).includes("must-not-leak"), false);
    assert.equal((await fetch(base + "/healthz")).status, 200);
  });
});

test("transport rejects mutation methods and unknown routes", async () => {
  await withServer({ getSnapshot: async () => validSnapshot() }, async base => {
    assert.equal((await fetch(base + "/api/paper-dashboard", { method: "POST" })).status, 405);
    assert.equal((await fetch(base + "/api/submit-order")).status, 404);
  });
});

test("transport fails closed for invalid or unavailable snapshots", async () => {
  await withServer({ getSnapshot: async () => ({ schemaVersion: 1, source: { mode: "PAPER_ONLY" }, viewModel: { mode: "PAPER_ONLY", permissions: { readOnly: true, maySubmitOrders: true, mayMutateLedger: false, mayResetRisk: false } } }) }, async base => {
    assert.equal((await fetch(base + "/api/paper-dashboard")).status, 503);
  });
  await withServer({ getSnapshot: async () => { throw new Error("internal details"); } }, async base => {
    const response = await fetch(base + "/api/paper-dashboard");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "SNAPSHOT_UNAVAILABLE" });
  });
});

test("transport enforces loopback binding and response size", async () => {
  assert.throws(() => createPaperDashboardHttpServer({ getSnapshot: async () => validSnapshot(), host: "0.0.0.0" }), /loopback/);
  await withServer({ getSnapshot: async () => validSnapshot(), maxResponseBytes: 10 }, async base => {
    assert.equal((await fetch(base + "/api/paper-dashboard")).status, 503);
  });
});
