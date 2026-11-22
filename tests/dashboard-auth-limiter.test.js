import test from "node:test";
import assert from "node:assert/strict";
import { createDashboardAuthLimiter, clientKey } from "../src/paper/dashboard-auth-limiter.js";
import { startPaperDashboardHttpServer } from "../src/paper/paper-dashboard-http-server.js";

const AUTH = { username: "owner", password: "correct-horse-battery-staple-42" };
const basic = (u, p) => "Basic " + Buffer.from(u + ":" + p).toString("base64");

test("limiter locks a client after repeated failures and a success clears its history", () => {
  let t = 1_000_000;
  const limiter = createDashboardAuthLimiter({ maxFailuresPerClient: 3, now: () => t });
  limiter.recordFailure("a"); limiter.recordFailure("a");
  limiter.recordSuccess("a");
  limiter.recordFailure("a"); limiter.recordFailure("a");
  assert.equal(limiter.check("a").allowed, true, "success reset the count");
  limiter.recordFailure("a");
  const locked = limiter.check("a");
  assert.equal(locked.allowed, false);
  assert.equal(locked.reason, "CLIENT_LOCKED_OUT");
  assert.equal(limiter.check("b").allowed, true, "other clients are unaffected");
  t += 15 * 60_000 + 1;
  assert.equal(limiter.check("a").allowed, true, "lockout expires");
});

test("failures outside the window do not accumulate", () => {
  let t = 0;
  const limiter = createDashboardAuthLimiter({ maxFailuresPerClient: 2, windowMs: 1_000, now: () => t });
  limiter.recordFailure("a"); t += 1_001; limiter.recordFailure("a");
  assert.equal(limiter.check("a").allowed, true);
});

test("global ceiling bounds guessing across rotating clients, and tracked clients stay bounded", () => {
  let t = 0;
  const limiter = createDashboardAuthLimiter({ maxFailuresGlobal: 5, maxTrackedClients: 3, now: () => t });
  for (let i = 0; i < 5; i++) limiter.recordFailure("ip-" + i);
  const gate = limiter.check("fresh-ip");
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason, "GLOBAL_FAILURE_CEILING");
  assert.ok(gate.retryAfterMs > 0);
  assert.equal(limiter.status().trackedClients, 3);
  t += 15 * 60_000;
  assert.equal(limiter.check("fresh-ip").allowed, true);
});

test("clientKey trusts only the proxy-appended (last) X-Forwarded-For entry, and only when enabled", () => {
  const request = { socket: { remoteAddress: "10.0.0.1" }, headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" } };
  assert.equal(clientKey(request), "10.0.0.1");
  assert.equal(clientKey(request, { trustProxy: true }), "203.0.113.9");
  assert.equal(clientKey({ socket: { remoteAddress: "10.0.0.1" }, headers: {} }, { trustProxy: true }), "10.0.0.1");
  assert.equal(clientKey({ socket: { remoteAddress: "10.0.0.1" }, headers: { "x-forwarded-for": "x".repeat(200) } }, { trustProxy: true }), "10.0.0.1");
});

async function withServer(options, fn) {
  const server = await startPaperDashboardHttpServer({
    getSnapshot: async () => { throw new Error("not needed"); },
    auth: AUTH, ...options
  });
  const base = "http://127.0.0.1:" + server.address().port;
  try { await fn(base); } finally { await new Promise(r => server.close(r)); }
}
const get = (base, path, headers = {}) => fetch(base + path, { headers });

test("HTTP: wrong passwords lead to 429 and the locked client cannot even try the right one", async () => {
  await withServer({ authLimiter: createDashboardAuthLimiter({ maxFailuresPerClient: 3 }) }, async base => {
    // A first visit without credentials is only a challenge, not a failure.
    for (let i = 0; i < 5; i++) assert.equal((await get(base, "/api/paper-dashboard")).status, 401);
    for (let i = 0; i < 3; i++) {
      assert.equal((await get(base, "/api/paper-dashboard", { authorization: basic("owner", "wrong-" + i) })).status, 401);
    }
    const blocked = await get(base, "/api/paper-dashboard", { authorization: basic(AUTH.username, AUTH.password) });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    // Health checks stay public and unaffected.
    assert.equal((await get(base, "/healthz")).status, 200);
  });
});

test("HTTP: behind a trusted proxy, lockout is per forwarded client", async () => {
  await withServer({ trustProxy: true, authLimiter: createDashboardAuthLimiter({ maxFailuresPerClient: 2 }) }, async base => {
    const attacker = { "x-forwarded-for": "198.51.100.7" };
    const owner = { "x-forwarded-for": "203.0.113.9" };
    for (let i = 0; i < 2; i++) await get(base, "/dashboard/", { ...attacker, authorization: basic("owner", "guess" + i) });
    assert.equal((await get(base, "/dashboard/", { ...attacker, authorization: basic(AUTH.username, AUTH.password) })).status, 429);
    // Spoofing an earlier XFF entry does not escape the lockout.
    assert.equal((await get(base, "/dashboard/", { "x-forwarded-for": "1.2.3.4, 198.51.100.7", authorization: basic("owner", "x") })).status, 429);
    const ok = await get(base, "/dashboard/", { ...owner, authorization: basic(AUTH.username, AUTH.password) });
    assert.equal(ok.status, 200);
  });
});

test("HTTP: auth is limited by default whenever auth is configured", async () => {
  await withServer({}, async base => {
    let last;
    for (let i = 0; i < 11; i++) last = await get(base, "/dashboard/", { authorization: basic("owner", "nope" + i) });
    assert.equal(last.status, 429);
  });
  await assert.rejects(startPaperDashboardHttpServer({ getSnapshot: async () => ({}), trustProxy: "yes" }), /trustProxy/);
});

test("CLI enables trustProxy with --trust-proxy or automatically on Render", async () => {
  const { parseBinanceSpotDashboardCliArgs } = await import("../src/paper/binance-spot-dashboard-cli-config.js");
  const saved = process.env.RENDER;
  try {
    delete process.env.RENDER;
    assert.equal(parseBinanceSpotDashboardCliArgs(["--ledger", "./x.jsonl"]).trustProxy, false);
    assert.equal(parseBinanceSpotDashboardCliArgs(["--ledger", "./x.jsonl", "--trust-proxy"]).trustProxy, true);
    process.env.RENDER = "true";
    assert.equal(parseBinanceSpotDashboardCliArgs(["--ledger", "./x.jsonl"]).trustProxy, true);
  } finally {
    if (saved === undefined) delete process.env.RENDER; else process.env.RENDER = saved;
  }
});
