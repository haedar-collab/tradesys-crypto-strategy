import { createBinanceSpotMultiSymbolDashboardFeedProvider } from "../data/binance-spot-multi-symbol-dashboard-feed-provider.js";
import { startPaperDashboardRuntimeHost } from "./paper-dashboard-runtime-host.js";
import { createBinanceSpotMtfScreenerProvider } from "../data/binance-spot-mtf-screener-provider.js";
import { createPaperTradingEngine } from "./paper-trading-engine.js";

export const DEFAULT_BINANCE_SPOT_DASHBOARD_SYMBOLS = Object.freeze([
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"
]);

/**
 * Production-shaped bootstrap for the local, read-only PAPER_ONLY dashboard.
 * It wires the five-symbol public Binance Spot feed into the existing runtime
 * host. No exchange credentials, order endpoints, or strategy execution are
 * introduced by this bootstrap.
 */
export async function startBinanceSpotPaperDashboardRuntime({
  filePath,
  symbols = DEFAULT_BINANCE_SPOT_DASHBOARD_SYMBOLS,
  selectedSymbol = symbols?.[0],
  maxSymbols = 20,
  feedFactory,
  feedOptions = {},
  sessionOptions = {},
  host = "127.0.0.1",
  port = 8787,
  maxQuoteAgeMs = 5_000,
  auth = null,
  trustProxy = false,
  now = () => Date.now(),
  strategyProvider,
  screenerRefreshIntervalMs = 60_000,
  screenerFetchKlines,
  // { acceptanceReport, options } enables the PAPER_ONLY trading engine; off by default.
  paperTrading = null,
  log = message => process.stdout.write(message + "\n")
} = {}) {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    throw new TypeError("a persistent paper ledger filePath is required");
  }
  const feedProvider = createBinanceSpotMultiSymbolDashboardFeedProvider({
    symbols, selectedSymbol, maxSymbols, feedFactory, feedOptions
  });
  const effectiveStrategyProvider = strategyProvider ?? createBinanceSpotMtfScreenerProvider({
    symbols,
    refreshIntervalMs: screenerRefreshIntervalMs,
    ...(screenerFetchKlines ? { fetchKlines: screenerFetchKlines } : {}),
    now
  });
  let engine = null;
  const dashboardStrategyProvider = paperTrading
    ? async () => {
      const snapshot = await effectiveStrategyProvider();
      const status = engine?.status();
      // Surface the real evidence-gate decision instead of NOT_EVALUATED.
      return status ? { ...snapshot, acceptance: status.acceptance } : snapshot;
    }
    : effectiveStrategyProvider;
  const runtime = await startPaperDashboardRuntimeHost({
    filePath,
    sessionOptions,
    feedProvider,
    strategyProvider: dashboardStrategyProvider,
    sessionWorkerFactory: paperTrading ? ({ session }) => {
      engine = createPaperTradingEngine({
        session,
        getFeedSnapshot: () => feedProvider.getSnapshot(),
        getScreenerSnapshot: effectiveStrategyProvider,
        acceptanceReport: paperTrading.acceptanceReport ?? null,
        options: paperTrading.options ?? {},
        now,
        log
      });
      const status = engine.status();
      log("[paper] trading engine enabled; entries " + (status.entriesEnabled ? "ENABLED" : "BLOCKED (acceptance " + status.acceptance.decision + ")"));
      return engine;
    } : null,
    host,
    port,
    maxQuoteAgeMs,
    auth,
    trustProxy,
    now
  });
  return Object.freeze({
    address: runtime.address,
    close: runtime.close,
    selectedSymbol,
    symbols: Object.freeze([...symbols]),
    paperTradingStatus: () => engine?.status() ?? null
  });
}
