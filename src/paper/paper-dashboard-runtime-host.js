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

  const session = await createPersistentPaperSession({
    ...sessionOptions,
    filePath,
    now
  });
  let server;
  let closed = false;
  try {
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
    await session.close().catch(() => {});
    throw error;
  }

  return Object.freeze({
    address: () => server.address(),
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
      await session.close();
    }
  });
}
