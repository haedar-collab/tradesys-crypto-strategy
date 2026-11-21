import { validateBinanceSpotQuote } from "../data/binance-spot-quote-contract.js";

/**
 * Marks every currently open paper position only when every held symbol has a
 * healthy, fresh, provenance-bearing quote. It never creates synthetic prices.
 */
export function createPaperMarketDataBridge({
  supervisor,
  session,
  now = Date.now,
  maxQuoteAgeMs = 5_000
} = {}) {
  if (!supervisor || typeof supervisor.checkHealth !== "function" ||
      typeof supervisor.getQuote !== "function") throw new TypeError("compatible multi-symbol supervisor is required");
  if (!session || typeof session.snapshot !== "function" ||
      typeof session.markToMarket !== "function") throw new TypeError("compatible persistent paper session is required");
  if (typeof now !== "function") throw new TypeError("now must be a function");
  if (!Number.isSafeInteger(maxQuoteAgeMs) || maxQuoteAgeMs < 1) throw new RangeError("maxQuoteAgeMs must be a positive integer");

  async function markOpenPositions() {
    const snapshot = await session.snapshot();
    const positions = snapshot?.broker?.positions;
    if (!Array.isArray(positions)) throw new TypeError("paper session snapshot has no broker positions array");
    if (positions.length === 0) return { status: "NO_OPEN_POSITIONS", marks: [] };

    const health = supervisor.checkHealth();
    const quotes = {};
    const rejected = [];
    for (const position of positions) {
      const symbol = position?.symbol;
      if (typeof symbol !== "string" || !symbol) {
        rejected.push({ symbol: null, reason: "INVALID_POSITION_SYMBOL" });
        continue;
      }
      const feedHealth = health?.[symbol];
      if (!feedHealth?.healthy) {
        rejected.push({ symbol, reason: feedHealth?.reason ?? "FEED_NOT_HEALTHY" });
        continue;
      }
      const quote = supervisor.getQuote(symbol);
      const validation = validateBinanceSpotQuote({
        quote, symbol, now: now(), maxAgeMs: maxQuoteAgeMs
      });
      if (!validation.valid) {
        rejected.push({ symbol, reason: validation.reason });
        continue;
      }
      quotes[symbol] = quote;
    }
    if (rejected.length > 0) {
      const error = new Error("paper mark blocked: one or more held symbols lack healthy fresh market data");
      error.code = "PAPER_MARKET_DATA_UNAVAILABLE";
      error.rejected = rejected;
      throw error;
    }
    const mark = await session.markToMarket(quotes);
    return { status: "MARKED", symbols: Object.keys(quotes), mark };
  }

  return Object.freeze({ markOpenPositions });
}
