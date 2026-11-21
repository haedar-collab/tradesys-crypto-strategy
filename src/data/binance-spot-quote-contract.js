const TRUSTED_SOURCE = "BINANCE_SPOT_WS_BOOK_TICKER";
const TRUSTED_EXCHANGE = "BINANCE";
const SYMBOL = /^[A-Z0-9]{5,20}$/;

function positive(value) {
  return Number.isFinite(value) && value > 0;
}

/**
 * Validate a normalized Binance Spot bookTicker quote at the application boundary.
 * Metadata is an adapter assertion, not cryptographic proof of exchange origin.
 */
export function validateBinanceSpotQuote({
  quote, symbol, now = Date.now(), maxAgeMs = 5_000
} = {}) {
  if (typeof symbol !== "string" || !SYMBOL.test(symbol)) {
    return { valid: false, reason: "INVALID_SYMBOL" };
  }
  if (!Number.isSafeInteger(now) || now < 0 ||
      !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) {
    return { valid: false, reason: "INVALID_VALIDATION_CLOCK" };
  }
  if (!quote || typeof quote !== "object" || Array.isArray(quote)) {
    return { valid: false, reason: "QUOTE_MISSING" };
  }
  if (quote.exchange !== TRUSTED_EXCHANGE ||
      quote.source !== TRUSTED_SOURCE ||
      quote.transport !== "WSS" ||
      quote.feedStatus !== "CONNECTED") {
    return { valid: false, reason: "UNTRUSTED_OR_DISCONNECTED_SOURCE" };
  }
  if (quote.symbol !== symbol || quote.stream !== symbol.toLowerCase() + "@bookTicker") {
    return { valid: false, reason: "SYMBOL_OR_STREAM_MISMATCH" };
  }
  if (!Number.isSafeInteger(quote.eventTime) || quote.eventTime < 0 ||
      !Number.isSafeInteger(quote.receivedAt) || quote.receivedAt < 0) {
    return { valid: false, reason: "INVALID_QUOTE_TIMESTAMPS" };
  }
  if (!positive(quote.bid) || !positive(quote.ask) || quote.ask < quote.bid) {
    return { valid: false, reason: "INVALID_BID_ASK" };
  }
  if (quote.eventTime > quote.receivedAt || quote.receivedAt > now || quote.eventTime > now) {
    return { valid: false, reason: "FUTURE_OR_INCONSISTENT_TIMESTAMP" };
  }
  if (now - quote.eventTime > maxAgeMs || now - quote.receivedAt > maxAgeMs) {
    return { valid: false, reason: "STALE_MARKET_DATA" };
  }
  return {
    valid: true,
    quote: {
      timestamp: quote.eventTime,
      bid: quote.bid,
      ask: quote.ask
    },
    provenance: {
      exchange: TRUSTED_EXCHANGE,
      source: TRUSTED_SOURCE,
      transport: "WSS",
      symbol,
      stream: quote.stream,
      eventTime: quote.eventTime,
      receivedAt: quote.receivedAt
    }
  };
}

export function createBinanceSpotBookTickerQuote({
  symbol, eventTime, receivedAt, bidPrice, askPrice, feedStatus = "CONNECTED"
} = {}) {
  return {
    exchange: TRUSTED_EXCHANGE,
    source: TRUSTED_SOURCE,
    transport: "WSS",
    feedStatus,
    symbol,
    stream: typeof symbol === "string" ? symbol.toLowerCase() + "@bookTicker" : "",
    eventTime,
    receivedAt,
    bid: Number(bidPrice),
    ask: Number(askPrice)
  };
}
