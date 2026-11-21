import { createBinanceSpotBookTickerSupervisor } from "./binance-spot-book-ticker-supervisor.js";

/**
 * Aggregate independent Binance Spot bookTicker feeds for a read-only dashboard.
 * A symbol is usable only while its own feed health check is healthy. Aggregate
 * health never upgrades an unhealthy symbol and never fabricates a quote.
 */
export function createBinanceSpotMultiSymbolDashboardFeedProvider({
  symbols,
  selectedSymbol = symbols?.[0],
  maxSymbols = 20,
  feedFactory,
  feedOptions = {}
} = {}) {
  if (!Array.isArray(symbols) || symbols.length === 0) {
    throw new TypeError("symbols must be a non-empty array");
  }
  if (typeof selectedSymbol !== "string" || !symbols.includes(selectedSymbol)) {
    throw new TypeError("selectedSymbol must be included in symbols");
  }
  const supervisor = createBinanceSpotBookTickerSupervisor({
    symbols, maxSymbols, feedFactory, feedOptions
  });
  let started = false;

  const provider = async function getMultiSymbolDashboardSnapshot() {
    const aggregate = supervisor.getSnapshot();
    const feeds = Object.fromEntries(Object.entries(aggregate.feeds).map(([symbol, feed]) => {
      const quote = feed.healthy ? feed.lastQuote : null;
      return [symbol, {
        state: !started ? "STOPPED" : feed.state,
        healthy: started && feed.healthy === true,
        reason: !started ? "STOPPED" : feed.reason ?? (feed.healthy ? null : "NO_HEALTHY_QUOTE"),
        ageMs: feed.ageMs ?? null,
        quote: quote ? {
          symbol: quote.symbol,
          timestamp: quote.eventTime,
          receivedAt: quote.receivedAt,
          bid: quote.bid,
          ask: quote.ask,
          source: quote.source,
          eventTimeBasis: quote.eventTimeBasis
        } : null
      }];
    }));
    const healthyCount = Object.values(feeds).filter(feed => feed.healthy).length;
    const state = !started ? "DISCONNECTED" :
      healthyCount === symbols.length ? "CONNECTED" :
      healthyCount > 0 ? "DEGRADED" : "WAIT_DATA";
    const selected = feeds[selectedSymbol];
    return {
      status: {
        state,
        symbolCount: symbols.length,
        healthyCount,
        unhealthySymbols: Object.entries(feeds).filter(([, feed]) => !feed.healthy).map(([symbol]) => symbol),
        selectedSymbol,
        feeds
      },
      quote: selected?.healthy ? selected.quote : null
    };
  };

  return Object.assign(provider, {
    start() {
      if (started) return;
      started = true;
      try {
        supervisor.start();
      } catch (error) {
        started = false;
        throw error;
      }
    },
    stop() {
      if (!started) return;
      started = false;
      supervisor.stop();
    },
    getSnapshot: () => supervisor.getSnapshot()
  });
}
