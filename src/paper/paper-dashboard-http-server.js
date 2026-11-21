import { createServer } from "node:http";
const MAX_RESPONSE_BYTES = 1_048_576;
const LOOPBACKS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

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
  maxResponseBytes = MAX_RESPONSE_BYTES
} = {}) {
  if (typeof getSnapshot !== "function") throw new TypeError("getSnapshot must be a function");
  if (host !== "127.0.0.1" && host !== "::1") {
    throw new Error("paper dashboard HTTP server may bind only to loopback");
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError("port must be an integer from 0 to 65535");
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > MAX_RESPONSE_BYTES) {
    throw new RangeError("maxResponseBytes must be between 1 byte and 1 MiB");
  }

  const server = createServer(async (request, response) => {
    if (!LOOPBACKS.has(request.socket.remoteAddress) || !LOOPBACKS.has(request.socket.localAddress)) {
      sendJson(response, 403, { error: "LOOPBACK_ONLY" });
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
