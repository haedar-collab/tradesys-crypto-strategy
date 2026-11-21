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
  const server = await startPaperDashboardHttpServer({ ...options, port: 0, host: "127.0.0.1" });
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
  await assert.rejects(startPaperDashboardHttpServer({ getSnapshot: async () => validSnapshot(), host: "0.0.0.0" }), /loopback/);
  await withServer({ getSnapshot: async () => validSnapshot(), maxResponseBytes: 10 }, async base => {
    assert.equal((await fetch(base + "/api/paper-dashboard")).status, 503);
  });
});

test("transport serves dashboard assets from the same loopback origin", async () => {
  await withServer({ getSnapshot: async () => validSnapshot() }, async base => {
    const page = await fetch(base + "/dashboard/");
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /connect-src 'self'/);
    assert.match(await page.text(), /Paper Trading Dashboard/);
    const script = await fetch(base + "/dashboard/dashboard.js");
    assert.equal(script.status, 200);
    assert.match(await script.text(), /api\/paper-dashboard/);
    assert.equal((await fetch(base + "/dashboard/..%2F..%2Fpackage.json")).status, 404);
  });
});


test("remote transport requires strong Basic authentication and keeps health probe public", async () => {
  await assert.rejects(
    startPaperDashboardHttpServer({ getSnapshot: async () => validSnapshot(), host: "0.0.0.0", port: 0 }),
    /non-loopback binding requires/
  );
  const auth = { username: "tradesys-owner", password: "a".repeat(32) };
  const server = await startPaperDashboardHttpServer({
    getSnapshot: async () => validSnapshot(), host: "0.0.0.0", port: 0, auth
  });
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    const denied = await fetch(base + "/api/paper-dashboard");
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get("www-authenticate"), /Basic/);
    assert.equal((await fetch(base + "/healthz")).status, 200);
    const credentials = Buffer.from(auth.username + ":" + auth.password).toString("base64");
    const allowed = await fetch(base + "/api/paper-dashboard", {
      headers: { authorization: "Basic " + credentials }
    });
    assert.equal(allowed.status, 200);
    assert.equal((await fetch(base + "/dashboard/", {
      headers: { authorization: "Basic " + credentials }
    })).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
