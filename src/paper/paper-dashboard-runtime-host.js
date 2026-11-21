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
  now = () => Date.now()
} = {}) {
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
  try {
    if (typeof feedProvider.start === "function") {
      await feedProvider.start();
      feedStarted = true;
    }
    server = await startPaperDashboardHttpServer({
      host,
      port,
      getSnapshot: () => createPaperDashboardRuntimeSnapshot({
        session,
        feedProvider,
        strategyProvider,
        maxQuoteAgeMs,
        now
      })
    });
  } catch (error) {
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
