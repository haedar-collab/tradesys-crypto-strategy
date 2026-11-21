/**
 * Binance Spot multi-timeframe screener adapter.
 * Fetching is injected; evaluation delegates to the existing causal MTF/SMC
 * engine. Only closed candles are admitted. This module emits research
 * candidates/WAIT states and never submits or sizes exchange orders.
 */
import { evaluateCausalMultiTimeframeSetup } from "../engine/causal-mtf.js";

const FRAMES = Object.freeze([
  ["weekly", "1w", 604800000],
  ["daily", "1d", 86400000],
  ["h4", "4h", 14400000],
  ["h1", "1h", 3600000]
]);
const DEFAULT_MINIMUM_BARS = Object.freeze({
  weekly: 220, daily: 220, h4: 220, h1: 60
});
const VALID_SYMBOL = /^[A-Z0-9]{5,20}$/;

function normalizeFetchedBars(rows, timeframe) {
  if (!Array.isArray(rows)) throw new TypeError(timeframe + " klines must be an array");
  return rows.map((bar, index) => {
    if (!bar || typeof bar !== "object" || Array.isArray(bar)) {
      throw new TypeError(timeframe + " kline " + index + " must be an object");
    }
    const candle = {
      openTime: Number(bar.openTime ?? bar.t),
      closeTime: Number(bar.closeTime),
      open: Number(bar.open ?? bar.o),
      high: Number(bar.high ?? bar.h),
      low: Number(bar.low ?? bar.l),
      close: Number(bar.close ?? bar.c),
      volume: Number(bar.volume ?? bar.v),
      ...(bar.quoteVolume == null ? {} : { quoteVolume: Number(bar.quoteVolume) })
    };
    if (!Object.values(candle).slice(0, 7).every(Number.isFinite)) {
      throw new TypeError(timeframe + " kline " + index + " contains non-finite fields");
    }
    return candle;
  });
}

function summarizeDecision(decision) {
  return Object.freeze({
    status: decision.status ?? "WAIT",
    candidate: decision.candidate === true,
    reasons: Object.freeze([...(decision.reasons ?? ["NO_DECISION_REASON"])]),
    trigger: decision.trigger ?? null,
    zone: decision.zone ?? null,
    plan: decision.plan ?? null,
    evidence: Object.freeze([...(decision.evidence ?? [])]),
    strategyVersion: decision.strategyVersion ?? null
  });
}

/**
 * @param {object} args
 * @param {string[]} args.symbols
 * @param {number} args.evaluationTime UTC epoch milliseconds
 * @param {(request:{symbol:string,interval:string,startTime:number,endTime:number})=>Promise<object[]>} args.fetchKlines
 */
export async function runBinanceSpotMtfScreener({
  symbols,
  evaluationTime = Date.now(),
  fetchKlines,
  minimumBars = DEFAULT_MINIMUM_BARS,
  strategyOptions = {}
} = {}) {
  if (!Array.isArray(symbols) || symbols.length === 0 ||
      symbols.some(symbol => typeof symbol !== "string" || !VALID_SYMBOL.test(symbol)) ||
      new Set(symbols).size !== symbols.length) {
    throw new TypeError("symbols must be a non-empty array of unique uppercase Binance Spot symbols");
  }
  if (!Number.isSafeInteger(evaluationTime) || evaluationTime < 0) {
    throw new TypeError("evaluationTime must be a non-negative UTC epoch timestamp");
  }
  if (typeof fetchKlines !== "function") throw new TypeError("fetchKlines must be a function");

  const results = await Promise.all(symbols.map(async symbol => {
    try {
      const entries = await Promise.all(FRAMES.map(async ([key, interval, intervalMs]) => {
        const response = await fetchKlines({
          symbol, interval, evaluationTime,
          startTime: evaluationTime - intervalMs * 230,
          endTime: evaluationTime
        });
        const rows = Array.isArray(response) ? response : response?.bars;
        return [key, normalizeFetchedBars(rows, key)];
      }));
      const candles = Object.fromEntries(entries);
      const decision = evaluateCausalMultiTimeframeSetup(candles, {
        ...strategyOptions,
        evaluationTime,
        minimumBars: { ...DEFAULT_MINIMUM_BARS, ...minimumBars, ...(strategyOptions.minimumBars ?? {}) },
        requireContiguous: strategyOptions.requireContiguous ?? false
      });
      const candidate = summarizeDecision(decision);
      return Object.freeze({
        symbol,
        state: candidate.candidate ? "BUY_CANDIDATE" : "WAIT",
        candidate,
        data: Object.freeze({
          source: "BINANCE_SPOT_PUBLIC_REST",
          intervals: Object.freeze(FRAMES.map(([, interval]) => interval)),
          closedCandlesOnly: true,
          candleCounts: Object.freeze(Object.fromEntries(FRAMES.map(([key]) => [key, candles[key].length]))),
          evaluationTime
        })
      });
    } catch (error) {
      return Object.freeze({
        symbol,
        state: "DATA_ERROR",
        candidate: Object.freeze({
          status: "WAIT_DATA",
          candidate: false,
          reasons: Object.freeze(["SCREENER_DATA_UNAVAILABLE"]),
          detail: String(error?.message ?? "unknown data error")
        }),
        data: Object.freeze({
          source: "BINANCE_SPOT_PUBLIC_REST",
          closedCandlesOnly: true,
          evaluationTime
        })
      });
    }
  }));

  const candidateCount = results.filter(item => item.state === "BUY_CANDIDATE").length;
  const dataErrorCount = results.filter(item => item.state === "DATA_ERROR").length;
  return Object.freeze({
    schemaVersion: 1,
    status: dataErrorCount === results.length ? "DATA_UNAVAILABLE" :
      dataErrorCount > 0 ? "PARTIAL" : "COMPLETE",
    mode: "SPOT_SIGNAL_ONLY",
    evaluationTime,
    symbolCount: results.length,
    candidateCount,
    waitCount: results.filter(item => item.state === "WAIT").length,
    dataErrorCount,
    results: Object.freeze(results),
    controls: Object.freeze({
      noExchangeOrders: true,
      noAccountCredentials: true,
      noSyntheticCandles: true,
      closedCandlesOnly: true,
      strategyEngine: "EXISTING_CAUSAL_MTF_SMC"
    }),
    limitations: Object.freeze([
      "A candidate is research output only and is not an order instruction.",
      "REST candle coverage and freshness must be validated by the caller.",
      "Live bookTicker health is a separate gate and is not inferred from candle availability."
    ])
  });
}

export { DEFAULT_MINIMUM_BARS as BINANCE_SPOT_SCREENER_MINIMUM_BARS };
