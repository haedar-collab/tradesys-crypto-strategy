import { createBinanceSpotBookTickerFeed } from "./binance-spot-book-ticker-feed.js";

/**
 * Lifecycle-aware dashboard provider for one Binance Spot symbol.
 * The function shape matches the read-only runtime adapter; start/stop are
 * optional lifecycle hooks consumed by the runtime host.
 */
export function createBinanceSpotDashboardFeedProvider({
  symbol,
  feedFactory = createBinanceSpotBookTickerFeed,
  feedOptions = {}
} = {}) {
  if (typeof symbol !== "string" || !/^[A-Z0-9]{5,20}$/.test(symbol)) {
    throw new TypeError("symbol must be an uppercase Binance Spot symbol");
  }
  if (typeof feedFactory !== "function") throw new TypeError("feedFactory must be a function");

  let latestQuote = null;
  let feedState = "STOPPED";
  const feed = feedFactory({
    ...feedOptions,
    symbol,
    onQuote: quote => { latestQuote = quote; },
    onState: event => { feedState = event.state; },
    onError: () => {}
  });
  if (!feed || typeof feed.start !== "function" || typeof feed.stop !== "function" ||
      typeof feed.getState !== "function" || typeof feed.getLastQuote !== "function") {
    throw new TypeError("feedFactory must return a compatible Binance Spot bookTicker feed");
  }

  let started = false;
  return Object.assign(async function getDashboardFeedSnapshot() {
    const state = feed.getState();
    const quote = feed.getLastQuote() ?? latestQuote;
    const connected = state === "CONNECTED" || state === "STALE";
    return {
      status: {
        state: connected ? "CONNECTED" : "DISCONNECTED",
        transportState: state,
        symbol,
        source: "BINANCE_SPOT_WS_BOOK_TICKER"
      },
      quote: quote ? {
        symbol: quote.symbol,
        timestamp: quote.eventTime,
        receivedAt: quote.receivedAt,
        bid: quote.bid,
        ask: quote.ask,
        source: quote.source,
        eventTimeBasis: quote.eventTimeBasis
      } : null
    };
  }, {
    start() {
      if (started) return;
      started = true;
      try {
        feed.start();
      } catch (error) {
        started = false;
        throw error;
      }
    },
    stop() {
      if (!started) return;
      started = false;
      feed.stop();
      latestQuote = null;
      feedState = "STOPPED";
    },
    getState: () => feed.getState(),
    getLastQuote: () => feed.getLastQuote()
  });
}
