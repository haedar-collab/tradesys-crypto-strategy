import { createPersistentPaperSession } from "./persistent-paper-session.js";
import { createPaperDashboardRuntimeSnapshot } from "./paper-dashboard-runtime-adapter.js";
import { startPaperDashboardHttpServer } from "./paper-dashboard-http-server.js";

/**
 * Start an isolated PAPER_ONLY session and its loopback read-only dashboard.
 * The returned host exposes only address/close; the mutable session handle is
 * deliberately kept private to this module.
 */
export async function startPaperDashboardRuntimeHost({
  filePath,
  sessionOptions = {},
  feedProvider = async () => ({ status: { state: "DISCONNECTED" }, quote: null }),
  strategyProvider = async () => ({ signal: null, acceptance: null }),
  host = "127.0.0.1",
  port = 0,
  maxQuoteAgeMs = 5_000,
  auth = null,
  trustProxy = false,
  now = () => Date.now(),
  // Optional background worker that may mutate the session (e.g. the paper
  // trading engine). It is the only component that receives the session
  // handle; the HTTP transport stays read-only.
  sessionWorkerFactory = null
} = {}) {
  if (sessionWorkerFactory !== null && typeof sessionWorkerFactory !== "function") {
    throw new TypeError("sessionWorkerFactory must be a function");
  }
  if (typeof filePath !== "string" || filePath.trim() === "") {
    throw new TypeError("a persistent paper ledger filePath is required");
  }
  if (sessionOptions.mode !== undefined && sessionOptions.mode !== "PAPER_ONLY") {
    throw new Error("runtime host supports PAPER_ONLY mode exclusively");
  }
  if (typeof feedProvider !== "function") throw new TypeError("feedProvider must be a function");

  const session = await createPersistentPaperSession({
    ...sessionOptions,
    filePath,
    now
  });
  let server;
  let feedStarted = false;
  let worker = null;
  try {
    if (typeof feedProvider.start === "function") {
      await feedProvider.start();
      feedStarted = true;
    }
    server = await startPaperDashboardHttpServer({
      host,
      port,
      auth,
      trustProxy,
      getSnapshot: () => createPaperDashboardRuntimeSnapshot({
        session,
        feedProvider,
        strategyProvider,
        maxQuoteAgeMs,
        now
      })
    });
    if (sessionWorkerFactory) {
      worker = sessionWorkerFactory({ session });
      if (!worker || typeof worker.start !== "function" || typeof worker.stop !== "function") {
        throw new TypeError("sessionWorkerFactory must return { start, stop }");
      }
      worker.start();
    }
  } catch (error) {
    if (server) await new Promise(resolve => server.close(() => resolve()));
    if (feedStarted && typeof feedProvider.stop === "function") {
      await Promise.resolve().then(() => feedProvider.stop()).catch(() => {});
    }
    await session.close().catch(() => {});
    throw error;
  }

  let closePromise;
  return Object.freeze({
    address: () => server.address(),
    close: () => {
      // Share one shutdown operation: concurrent callers must wait for the
      // same feed/server/session teardown rather than returning prematurely.
      closePromise ??= (async () => {
        let closeError = null;
        // Stop the session worker first so no order is in flight at teardown.
        if (worker) { try { await worker.stop(); } catch (error) { closeError = error; } worker = null; }
        try {
          if (feedStarted && typeof feedProvider.stop === "function") {
            try { await feedProvider.stop(); } catch (error) { closeError = error; }
            feedStarted = false;
          }
          try {
            await new Promise((resolve, reject) => {
              server.close(error => error ? reject(error) : resolve());
            });
          } catch (error) {
            closeError ??= error;
          }
        } finally {
          try { await session.close(); } catch (error) { closeError ??= error; }
        }
        if (closeError) throw closeError;
      })();
      return closePromise;
    }
  });
}
