import { writeFile } from "node:fs/promises";
import { createBinanceSpotBookTickerFeed } from "../src/data/binance-spot-book-ticker-feed.js";
import { validateBinanceSpotQuote } from "../src/data/binance-spot-quote-contract.js";
import { validateBinanceSpotLiveEvidence } from "../src/data/binance-spot-live-evidence.js";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
const TIMEOUT_MS = 20_000;

if (typeof globalThis.WebSocket !== "function") {
  throw new Error("Node.js global WebSocket is unavailable; use Node.js 22+");
}

function verifySymbol(symbol) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let feed;
    const timeout = setTimeout(() => {
      finish(new Error(symbol + " did not produce a valid quote within " + TIMEOUT_MS + "ms"));
    }, TIMEOUT_MS);

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      feed?.stop();
      if (error) reject(error);
      else resolve(result);
    }

    try {
      feed = createBinanceSpotBookTickerFeed({
        symbol,
        WebSocketCtor: globalThis.WebSocket,
        staleAfterMs: 10_000,
        reconnectBaseMs: 500,
        reconnectMaxMs: 2_000,
        onQuote: quote => {
          const checked = validateBinanceSpotQuote({
            quote,
            symbol,
            now: Date.now(),
            maxAgeMs: 10_000
          });
          if (!checked.valid) {
            finish(new Error(symbol + " quote rejected: " + checked.reason));
            return;
          }
          finish(null, {
            symbol,
            bid: quote.bid,
            ask: quote.ask,
            spread: quote.ask - quote.bid,
            ageMs: Date.now() - quote.receivedAt,
            eventTimeBasis: quote.eventTimeBasis,
            source: quote.source
          });
        },
        onError: error => {
          process.stderr.write("[feed-error] " + symbol + ": " + (error?.message ?? String(error)) + "\n");
        }
      });
      feed.start();
    } catch (error) {
      finish(error);
    }
  });
}

const results = await Promise.allSettled(SYMBOLS.map(verifySymbol));
const passed = results.filter(result => result.status === "fulfilled").map(result => result.value);
const failed = results.filter(result => result.status === "rejected").map(result => result.reason.message);
const report = {
  test: "BINANCE_SPOT_PUBLIC_WEBSOCKET_SMOKE",
  checkedAt: new Date().toISOString(),
  requestedSymbols: SYMBOLS,
  passed,
  failed,
  success: failed.length === 0 && passed.length === SYMBOLS.length
};
report.acceptance = validateBinanceSpotLiveEvidence(report);
report.success = report.acceptance.accepted;
const serialized = JSON.stringify(report, null, 2);
console.log(serialized);
if (process.env.BINANCE_SMOKE_REPORT_PATH) {
  await writeFile(process.env.BINANCE_SMOKE_REPORT_PATH, serialized + "\n", {
    encoding: "utf8",
    mode: 0o600,
    flag: "w"
  });
}
if (!report.success) process.exitCode = 1;
