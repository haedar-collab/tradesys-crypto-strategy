import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
const MAX_RESPONSE_BYTES = 1_048_576;
const LOOPBACKS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function isAuthorized(header, auth) {
  if (typeof header !== "string" || !header.startsWith("Basic ")) return false;
  let decoded;
  try { decoded = Buffer.from(header.slice(6), "base64").toString("utf8"); } catch { return false; }
  const separator = decoded.indexOf(":");
  if (separator < 1) return false;
  const username = Buffer.from(decoded.slice(0, separator));
  const password = Buffer.from(decoded.slice(separator + 1));
  const expectedUsername = Buffer.from(auth.username);
  const expectedPassword = Buffer.from(auth.password);
  const usernameMatches = username.length === expectedUsername.length && timingSafeEqual(username, expectedUsername);
  const passwordMatches = password.length === expectedPassword.length && timingSafeEqual(password, expectedPassword);
  return usernameMatches && passwordMatches;
}

function sendJson(response, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": payload.length,
    "cache-control": "no-store, max-age=0",
    "pragma": "no-cache",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'"
  });
  response.end(payload);
}

/**
 * Read-only loopback HTTP transport for the paper dashboard.
 * The provider must return createPaperDashboardRuntimeSnapshot() output.
 * Only its view model and non-sensitive provenance metadata leave this process;
 * raw ledger events and broker internals are never sent over HTTP.
 */
export async function startPaperDashboardHttpServer({
  getSnapshot,
  host = "127.0.0.1",
  port = 0,
  maxResponseBytes = MAX_RESPONSE_BYTES,
  auth = null
} = {}) {
  if (typeof getSnapshot !== "function") throw new TypeError("getSnapshot must be a function");
  const loopbackHost = host === "127.0.0.1" || host === "::1";
  const validAuth = auth && typeof auth.username === "string" && auth.username.length > 0 &&
    typeof auth.password === "string" && auth.password.length >= 24;
  if (!loopbackHost && !(host === "0.0.0.0" && validAuth)) {
    throw new Error("non-loopback binding requires 0.0.0.0 and valid dashboard authentication");
  }
  if (auth !== null && !validAuth) throw new Error("dashboard auth requires a username and a password of at least 24 characters");
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError("port must be an integer from 0 to 65535");
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > MAX_RESPONSE_BYTES) {
    throw new RangeError("maxResponseBytes must be between 1 byte and 1 MiB");
  }

  const server = createServer(async (request, response) => {
    if (loopbackHost && (!LOOPBACKS.has(request.socket.remoteAddress) || !LOOPBACKS.has(request.socket.localAddress))) {
      sendJson(response, 403, { error: "LOOPBACK_ONLY" });
      return;
    }
    if (auth && !isAuthorized(request.headers.authorization, auth)) {
      response.writeHead(401, {
        "www-authenticate": 'Basic realm="Tradesys Crypto", charset="UTF-8"',
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      });
      response.end("Authentication required");
      return;
    }
    if (request.method !== "GET") {
      response.setHeader("allow", "GET");
      sendJson(response, 405, { error: "METHOD_NOT_ALLOWED" });
      return;
    }
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (path === "/healthz") {
      sendJson(response, 200, { status: "OK", mode: "PAPER_ONLY", readOnly: true });
      return;
    }
    const staticFiles = {
      "/dashboard/": ["../../dashboard/index.html", "text/html; charset=utf-8"],
      "/dashboard/index.html": ["../../dashboard/index.html", "text/html; charset=utf-8"],
      "/dashboard/dashboard.js": ["../../dashboard/dashboard.js", "text/javascript; charset=utf-8"],
      "/dashboard/dashboard.css": ["../../dashboard/dashboard.css", "text/css; charset=utf-8"],
      "/src/paper/paper-dashboard-view-model.js": ["./paper-dashboard-view-model.js", "text/javascript; charset=utf-8"]
    };
    if (path === "/dashboard") {
      response.writeHead(302, { location: "/dashboard/", "cache-control": "no-store" });
      response.end();
      return;
    }
    if (staticFiles[path]) {
      try {
        const [relativePath, contentType] = staticFiles[path];
        const file = await readFile(new URL(relativePath, import.meta.url));
        response.writeHead(200, {
          "content-type": contentType,
          "content-length": file.length,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
          "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        });
        response.end(file);
      } catch {
        sendJson(response, 500, { error: "STATIC_ASSET_UNAVAILABLE" });
      }
      return;
    }
    if (path !== "/api/paper-dashboard") {
      sendJson(response, 404, { error: "NOT_FOUND" });
      return;
    }

    try {
      const result = await getSnapshot();
      if (!result || result.schemaVersion !== 1 ||
          result.source?.mode !== "PAPER_ONLY" ||
          !result.viewModel || result.viewModel.mode !== "PAPER_ONLY" ||
          result.viewModel.permissions?.readOnly !== true ||
          result.viewModel.permissions?.maySubmitOrders !== false ||
          result.viewModel.permissions?.mayMutateLedger !== false ||
          result.viewModel.permissions?.mayResetRisk !== false) {
        sendJson(response, 503, { error: "SNAPSHOT_INVALID_OR_NOT_READ_ONLY" });
        return;
      }
      const body = {
        schemaVersion: 1,
        generatedAt: result.generatedAt,
        source: result.source,
        viewModel: result.viewModel
      };
      const payload = Buffer.from(JSON.stringify(body));
      if (payload.length > maxResponseBytes) {
        sendJson(response, 503, { error: "SNAPSHOT_TOO_LARGE" });
        return;
      }
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-length": payload.length,
        "cache-control": "no-store, max-age=0",
        "pragma": "no-cache",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'"
      });
      response.end(payload);
    } catch {
      sendJson(response, 503, { error: "SNAPSHOT_UNAVAILABLE" });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return server;
}
