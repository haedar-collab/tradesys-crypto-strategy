import { fetchBinanceSpotKlines } from "./binance-spot-klines.js";
import { runBinanceSpotMtfScreener } from "../screener/binance-spot-mtf-screener.js";

const INTERVAL_MS = Object.freeze({ "1w":604800000, "1d":86400000, "4h":14400000, "1h":3600000 });

/**
 * Cached read-only screener provider for the PAPER_ONLY dashboard.
 * Cache prevents every dashboard poll from triggering another REST scan.
 */
export function createBinanceSpotMtfScreenerProvider({
  symbols,
  fetchKlines = fetchBinanceSpotKlines,
  now = () => Date.now(),
  refreshIntervalMs = 60_000,
  minimumBars
} = {}) {
  if (!Array.isArray(symbols) || symbols.length === 0 ||
      new Set(symbols).size !== symbols.length ||
      symbols.some(symbol => typeof symbol !== "string" || !/^[A-Z0-9]{5,20}$/.test(symbol))) {
    throw new TypeError("symbols must be a non-empty list of unique Binance Spot symbols");
  }
  if (typeof fetchKlines !== "function" || typeof now !== "function") {
    throw new TypeError("fetchKlines and now must be functions");
  }
  if (!Number.isSafeInteger(refreshIntervalMs) || refreshIntervalMs < 5_000) {
    throw new RangeError("refreshIntervalMs must be at least 5000 ms");
  }
  let cachedAt = -Infinity;
  let cached = null;
  let pending = null;

  async function refresh(evaluationTime) {
    return runBinanceSpotMtfScreener({
      symbols,
      evaluationTime,
      minimumBars,
      fetchKlines: ({ symbol, interval }) => fetchKlines({
        symbol,
        interval,
        startTime: evaluationTime - INTERVAL_MS[interval] * 230,
        endTime: evaluationTime
      })
    });
  }

  return async function getScreenerSnapshot() {
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new TypeError("now must return a non-negative UTC epoch timestamp");
    }
    if (cached && timestamp - cachedAt < refreshIntervalMs) return cached;
    if (!pending) {
      pending = refresh(timestamp).then(report => {
        cached = Object.freeze({
          screener: report,
          signal: Object.freeze({
            symbol: report.results.find(item => item.state === "BUY_CANDIDATE")?.symbol ?? null,
            side: report.candidateCount > 0 ? "BUY" : null,
            decision: report.candidateCount > 0 ? "BUY_CANDIDATE" : "WAIT",
            reasons: Object.freeze(report.results.flatMap(item => item.candidate.reasons ?? []))
          }),
          acceptance: Object.freeze({ decision: "NOT_EVALUATED" })
        });
        cachedAt = timestamp;
        return cached;
      }).finally(() => { pending = null; });
    }
    return pending;
  };
}
