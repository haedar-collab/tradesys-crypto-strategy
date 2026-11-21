const DEFAULT_SYMBOLS = Object.freeze(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"]);
const REPORT_TYPE = "BINANCE_SPOT_PUBLIC_WEBSOCKET_SMOKE";

function fail(reason) {
  return Object.freeze({ accepted: false, status: "REJECTED", reasons: Object.freeze([reason]) });
}

/**
 * Validate the structure and acceptance criteria of a smoke-test report.
 * This validates report consistency, not cryptographic origin or future feed health.
 */
export function validateBinanceSpotLiveEvidence(report, {
  expectedSymbols = DEFAULT_SYMBOLS,
  maxAgeMs = 10_000
} = {}) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return fail("REPORT_MISSING_OR_INVALID");
  if (report.test !== REPORT_TYPE) return fail("REPORT_TYPE_MISMATCH");
  if (typeof report.checkedAt !== "string" || !Number.isFinite(Date.parse(report.checkedAt)) ||
      new Date(report.checkedAt).toISOString() !== report.checkedAt) return fail("INVALID_CHECKED_AT");
  if (!Array.isArray(expectedSymbols) || expectedSymbols.length === 0 ||
      new Set(expectedSymbols).size !== expectedSymbols.length) return fail("INVALID_EXPECTED_SYMBOLS");
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1) return fail("INVALID_MAX_AGE");
  if (!Array.isArray(report.requestedSymbols) ||
      report.requestedSymbols.length !== expectedSymbols.length ||
      expectedSymbols.some((symbol, index) => report.requestedSymbols[index] !== symbol)) {
    return fail("REQUESTED_SYMBOL_SET_MISMATCH");
  }
  if (!Array.isArray(report.passed) || !Array.isArray(report.failed)) return fail("RESULT_LISTS_MISSING");
  if (report.failed.length !== 0) return fail("ONE_OR_MORE_SYMBOLS_FAILED");
  if (report.passed.length !== expectedSymbols.length) return fail("PASS_COUNT_MISMATCH");

  const seen = new Set();
  for (const item of report.passed) {
    if (!item || typeof item !== "object" || !expectedSymbols.includes(item.symbol)) return fail("UNEXPECTED_SYMBOL");
    if (seen.has(item.symbol)) return fail("DUPLICATE_SYMBOL");
    seen.add(item.symbol);
    if (!Number.isFinite(item.bid) || item.bid <= 0 ||
        !Number.isFinite(item.ask) || item.ask < item.bid) return fail("INVALID_BID_ASK");
    if (!Number.isFinite(item.spread) || Math.abs(item.spread - (item.ask - item.bid)) > Math.max(1e-12, Math.abs(item.ask - item.bid) * 1e-9)) {
      return fail("INVALID_SPREAD");
    }
    if (!Number.isSafeInteger(item.ageMs) || item.ageMs < 0 || item.ageMs > maxAgeMs) return fail("STALE_OR_INVALID_QUOTE_AGE");
    if (item.source !== "BINANCE_SPOT_WS_BOOK_TICKER") return fail("UNTRUSTED_QUOTE_SOURCE");
    if (!["EXCHANGE_EVENT_TIME", "LOCAL_RECEIVE_TIME"].includes(item.eventTimeBasis)) return fail("INVALID_EVENT_TIME_BASIS");
  }
  if (seen.size !== expectedSymbols.length || expectedSymbols.some(symbol => !seen.has(symbol))) {
    return fail("MISSING_SYMBOL");
  }
  if (report.success !== true) return fail("REPORT_NOT_MARKED_SUCCESS");
  return Object.freeze({
    accepted: true,
    status: "ACCEPTED",
    reasons: Object.freeze([]),
    checkedAt: report.checkedAt,
    symbols: Object.freeze([...expectedSymbols]),
    maxAgeMs
  });
}

export const BINANCE_SPOT_LIVE_EVIDENCE_SYMBOLS = DEFAULT_SYMBOLS;
