import { createBinanceSpotMultiSymbolDashboardFeedProvider } from "../data/binance-spot-multi-symbol-dashboard-feed-provider.js";
import { startPaperDashboardRuntimeHost } from "./paper-dashboard-runtime-host.js";

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
  now = () => Date.now(),
  strategyProvider
} = {}) {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    throw new TypeError("a persistent paper ledger filePath is required");
  }
  const feedProvider = createBinanceSpotMultiSymbolDashboardFeedProvider({
    symbols, selectedSymbol, maxSymbols, feedFactory, feedOptions
  });
  const runtime = await startPaperDashboardRuntimeHost({
    filePath,
    sessionOptions,
    feedProvider,
    ...(strategyProvider ? { strategyProvider } : {}),
    host,
    port,
    maxQuoteAgeMs,
    now
  });
  return Object.freeze({
    address: runtime.address,
    close: runtime.close,
    selectedSymbol,
    symbols: Object.freeze([...symbols])
  });
}
