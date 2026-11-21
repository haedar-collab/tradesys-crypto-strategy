import { createBinanceSpotBookTickerFeed } from "./binance-spot-book-ticker-feed.js";

const SYMBOL_PATTERN = /^[A-Z0-9]{5,20}$/;

/**
 * Owns a bounded set of single-symbol feeds. It coordinates lifecycle and health;
 * it does not combine books or submit paper orders.
 */
export function createBinanceSpotBookTickerSupervisor({
  symbols,
  maxSymbols = 20,
  feedFactory = createBinanceSpotBookTickerFeed,
  feedOptions = {},
  onQuote = () => {},
  onState = () => {},
  onError = () => {}
} = {}) {
  if (!Array.isArray(symbols) || symbols.length === 0) throw new TypeError("symbols must be a non-empty array");
  if (!Number.isSafeInteger(maxSymbols) || maxSymbols < 1) throw new RangeError("maxSymbols must be a positive integer");
  if (symbols.length > maxSymbols) throw new RangeError("symbols exceeds maxSymbols");
  if (symbols.some(symbol => typeof symbol !== "string" || !SYMBOL_PATTERN.test(symbol))) throw new TypeError("every symbol must be an uppercase Binance Spot symbol");
  if (new Set(symbols).size !== symbols.length) throw new TypeError("symbols must be unique");
  if (typeof feedFactory !== "function") throw new TypeError("feedFactory must be a function");
  if (![onQuote, onState, onError].every(fn => typeof fn === "function")) throw new TypeError("callbacks must be functions");

  const feeds = new Map();
  const states = new Map(symbols.map(symbol => [symbol, "STOPPED"]));
  const errors = new Map();
  let started = false;

  for (const symbol of symbols) {
    const feed = feedFactory({
      ...feedOptions,
      symbol,
      onQuote: quote => onQuote(quote),
      onState: event => {
        states.set(symbol, event.state);
        onState(event);
      },
      onError: error => {
        errors.set(symbol, error instanceof Error ? error.message : String(error));
        onError({ symbol, error });
      }
    });
    if (!feed || typeof feed.start !== "function" || typeof feed.stop !== "function" ||
        typeof feed.checkHealth !== "function" || typeof feed.getLastQuote !== "function") {
      throw new TypeError("feedFactory must return a compatible bookTicker feed");
    }
    feeds.set(symbol, feed);
  }

  function checkHealth() {
    return Object.fromEntries([...feeds].map(([symbol, feed]) => [symbol, {
      ...feed.checkHealth(),
      state: states.get(symbol),
      lastQuote: feed.getLastQuote()
    }]));
  }

  return {
    start() {
      if (started) return;
      started = true;
      for (const [symbol, feed] of feeds) {
        try { feed.start(); }
        catch (error) {
          states.set(symbol, "ERROR");
          errors.set(symbol, error instanceof Error ? error.message : String(error));
          onError({ symbol, error });
        }
      }
      onState({ state: "RUNNING", symbols: [...symbols] });
    },
    stop() {
      if (!started) return;
      started = false;
      for (const [symbol, feed] of feeds) {
        try { feed.stop(); }
        catch (error) {
          errors.set(symbol, error instanceof Error ? error.message : String(error));
          onError({ symbol, error });
        }
        states.set(symbol, "STOPPED");
      }
      onState({ state: "STOPPED", symbols: [...symbols] });
    },
    checkHealth,
    getQuote(symbol) {
      const feed = feeds.get(symbol);
      return feed ? feed.getLastQuote() : null;
    },
    getSnapshot() {
      const perSymbol = checkHealth();
      const healthyCount = Object.values(perSymbol).filter(item => item.healthy).length;
      return {
        state: started ? "RUNNING" : "STOPPED",
        symbolCount: feeds.size,
        healthyCount,
        unhealthySymbols: Object.entries(perSymbol).filter(([, item]) => !item.healthy).map(([symbol]) => symbol),
        errors: Object.fromEntries(errors),
        feeds: perSymbol
      };
    }
  };
}
