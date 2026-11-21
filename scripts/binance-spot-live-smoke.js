#!/usr/bin/env node
import { createBinanceSpotBookTickerFeed } from "../src/data/binance-spot-book-ticker-feed.js";

const symbol = (process.argv[2] ?? "BTCUSDT").toUpperCase();
const timeoutMs = Number(process.env.BINANCE_SMOKE_TIMEOUT_MS ?? 15_000);

if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
  console.error("Usage: node scripts/binance-spot-live-smoke.js [BTCUSDT]");
  process.exitCode = 2;
} else if (typeof globalThis.WebSocket !== "function") {
  console.error("This Node.js runtime does not expose globalThis.WebSocket. Use a supported Node.js release or provide a WebSocket runtime.");
  process.exitCode = 2;
} else if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
  console.error("BINANCE_SMOKE_TIMEOUT_MS must be an integer from 1000 to 120000.");
  process.exitCode = 2;
} else {
  let settled = false;
  let feed;
  let timeout;

  const finish = (code, result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    feed?.stop();
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = code;
  };

  feed = createBinanceSpotBookTickerFeed({
    symbol,
    WebSocketCtor: globalThis.WebSocket,
    staleAfterMs: Math.max(timeoutMs, 5_000),
    onQuote: quote => {
      const ageMs = Date.now() - quote.receivedAt;
      const valid = quote.symbol === symbol &&
        quote.source === "BINANCE_SPOT_WS_BOOK_TICKER" &&
        quote.transport === "WSS" &&
        quote.feedStatus === "CONNECTED" &&
        Number.isFinite(quote.bid) && quote.bid > 0 &&
        Number.isFinite(quote.ask) && quote.ask >= quote.bid &&
        ageMs >= 0 && ageMs < 5_000;

      finish(valid ? 0 : 1, {
        status: valid ? "LIVE_QUOTE_RECEIVED" : "INVALID_LIVE_QUOTE",
        symbol,
        stream: quote.stream,
        eventTimeBasis: quote.eventTimeBasis,
        bid: quote.bid,
        ask: quote.ask,
        updateId: quote.updateId,
        receivedAt: new Date(quote.receivedAt).toISOString(),
        receiveAgeMs: ageMs,
        endpoint: feed.getUrl()
      });
    },
    onError: error => {
      console.error("Binance WebSocket adapter error:", error?.message ?? String(error));
    }
  });

  timeout = setTimeout(() => {
    finish(1, {
      status: "LIVE_QUOTE_TIMEOUT",
      symbol,
      timeoutMs,
      endpoint: feed.getUrl()
    });
  }, timeoutMs);

  console.log(`Connecting to Binance Spot ${symbol} bookTicker...`);
  feed.start();
}
