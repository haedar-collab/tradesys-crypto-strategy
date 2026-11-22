import { fetchBinanceSpotKlines } from "./binance-spot-klines.js";
import { runBinanceSpotMtfScreener, BINANCE_SPOT_SCREENER_LOOKBACK_BARS } from "../screener/binance-spot-mtf-screener.js";

const INTERVAL_MS = Object.freeze({ "1w":604800000, "1d":86400000, "4h":14400000, "1h":3600000 });
const LOOKBACK_BY_INTERVAL = Object.freeze({
  "1w": BINANCE_SPOT_SCREENER_LOOKBACK_BARS.weekly, "1d": BINANCE_SPOT_SCREENER_LOOKBACK_BARS.daily,
  "4h": BINANCE_SPOT_SCREENER_LOOKBACK_BARS.h4, "1h": BINANCE_SPOT_SCREENER_LOOKBACK_BARS.h1
});

const EMPTY_COUNTS = Object.freeze({ symbolCount: 0, candidateCount: 0, waitCount: 0, dataErrorCount: 0, results: Object.freeze([]) });

function placeholder(status, detail) {
  return Object.freeze({
    screener: Object.freeze({ schemaVersion: 1, status, mode: "SPOT_SIGNAL_ONLY", ...EMPTY_COUNTS, ...(detail ? { detail } : {}) }),
    signal: null,
    acceptance: Object.freeze({ decision: "NOT_EVALUATED" })
  });
}

/**
 * Cached read-only screener provider for the PAPER_ONLY dashboard.
 * - The cache prevents every dashboard poll from triggering another REST scan.
 * - Stale-while-revalidate: once a result exists, polls return it immediately
 *   and a refresh runs in the background, so Binance latency never blocks the
 *   dashboard. Results older than staleAfterMs are reported as status STALE.
 * - The very first scan is awaited for at most firstLoadTimeoutMs; after that
 *   a LOADING placeholder is returned while the scan continues.
 * - A failed refresh keeps the previous result and is retried no sooner than
 *   retryAfterFailureMs, so outages do not hammer the public API.
 */
export function createBinanceSpotMtfScreenerProvider({
  symbols,
  fetchKlines = fetchBinanceSpotKlines,
  now = () => Date.now(),
  refreshIntervalMs = 60_000,
  staleAfterMs = refreshIntervalMs * 3,
  firstLoadTimeoutMs = 2_000,
  retryAfterFailureMs = 15_000,
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
  if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < refreshIntervalMs) {
    throw new RangeError("staleAfterMs must be an integer >= refreshIntervalMs");
  }
  for (const [name, value] of Object.entries({ firstLoadTimeoutMs, retryAfterFailureMs })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(name + " must be a non-negative integer");
  }
  let cachedAt = -Infinity;
  let cached = null;
  let pending = null;
  let failedAt = -Infinity;
  let lastError = null;

  async function refresh(evaluationTime) {
    return runBinanceSpotMtfScreener({
      symbols,
      evaluationTime,
      minimumBars,
      fetchKlines: ({ symbol, interval }) => fetchKlines({
        symbol,
        interval,
        startTime: evaluationTime - INTERVAL_MS[interval] * LOOKBACK_BY_INTERVAL[interval],
        endTime: evaluationTime
      })
    });
  }

  function startRefresh(timestamp) {
    if (pending) return pending;
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
      lastError = null;
      return cached;
    }, error => {
      failedAt = timestamp;
      lastError = String(error?.message ?? error);
      return null;
    }).finally(() => { pending = null; });
    return pending;
  }

  function present(timestamp) {
    if (!cached) {
      return lastError ? placeholder("DATA_UNAVAILABLE", lastError) : placeholder("LOADING");
    }
    if (timestamp - cachedAt <= staleAfterMs) return cached;
    return Object.freeze({
      ...cached,
      signal: null, // never surface an outdated candidate as current
      screener: Object.freeze({ ...cached.screener, status: "STALE", staleSince: cachedAt + staleAfterMs })
    });
  }

  return async function getScreenerSnapshot() {
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new TypeError("now must return a non-negative UTC epoch timestamp");
    }
    const due = timestamp - cachedAt >= refreshIntervalMs;
    const backingOff = timestamp - failedAt < retryAfterFailureMs;
    if (due && !backingOff) {
      const refreshing = startRefresh(timestamp);
      if (!cached) {
        // First load: wait briefly so a fast scan is shown immediately.
        let timer;
        await Promise.race([
          refreshing,
          new Promise(resolve => { timer = setTimeout(resolve, firstLoadTimeoutMs); timer.unref?.(); })
        ]);
        clearTimeout(timer);
      }
    }
    return present(timestamp);
  };
}
