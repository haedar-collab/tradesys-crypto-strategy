import test from "node:test";
import assert from "node:assert/strict";
import {
  createBinanceSpotBookTickerQuote,
  validateBinanceSpotQuote
} from "../src/data/binance-spot-quote-contract.js";

const NOW = 1_800_000_000_000;
function valid(overrides = {}) {
  return createBinanceSpotBookTickerQuote({
    symbol: "BTCUSDT", eventTime: NOW - 100, receivedAt: NOW - 50,
    bidPrice: "100", askPrice: "100.1", ...overrides
  });
}

test("accepts normalized connected Binance Spot bookTicker quote", () => {
  const result = validateBinanceSpotQuote({ quote: valid(), symbol: "BTCUSDT", now: NOW, maxAgeMs: 5_000 });
  assert.equal(result.valid, true);
  assert.deepEqual(result.quote, { timestamp: NOW - 100, bid: 100, ask: 100.1 });
  assert.equal(result.provenance.source, "BINANCE_SPOT_WS_BOOK_TICKER");
});

test("rejects mismatched symbol or stream", () => {
  assert.equal(validateBinanceSpotQuote({ quote: valid(), symbol: "ETHUSDT", now: NOW }).reason, "SYMBOL_OR_STREAM_MISMATCH");
  assert.equal(validateBinanceSpotQuote({ quote: { ...valid(), stream: "ethusdt@bookTicker" }, symbol: "BTCUSDT", now: NOW }).reason, "SYMBOL_OR_STREAM_MISMATCH");
});

test("rejects untrusted source, disconnected feed, stale data and future timestamps", () => {
  assert.equal(validateBinanceSpotQuote({ quote: { ...valid(), source: "MANUAL" }, symbol: "BTCUSDT", now: NOW }).reason, "UNTRUSTED_OR_DISCONNECTED_SOURCE");
  assert.equal(validateBinanceSpotQuote({ quote: valid({ feedStatus: "DISCONNECTED" }), symbol: "BTCUSDT", now: NOW }).reason, "UNTRUSTED_OR_DISCONNECTED_SOURCE");
  assert.equal(validateBinanceSpotQuote({ quote: valid({ eventTime: NOW - 10_000 }), symbol: "BTCUSDT", now: NOW, maxAgeMs: 5_000 }).reason, "STALE_MARKET_DATA");
  assert.equal(validateBinanceSpotQuote({ quote: valid({ receivedAt: NOW + 1 }), symbol: "BTCUSDT", now: NOW }).reason, "FUTURE_OR_INCONSISTENT_TIMESTAMP");
});

test("rejects invalid bid ask and event time after receive time", () => {
  assert.equal(validateBinanceSpotQuote({ quote: valid({ askPrice: "99" }), symbol: "BTCUSDT", now: NOW }).reason, "INVALID_BID_ASK");
  assert.equal(validateBinanceSpotQuote({ quote: valid({ eventTime: NOW - 10, receivedAt: NOW - 20 }), symbol: "BTCUSDT", now: NOW }).reason, "FUTURE_OR_INCONSISTENT_TIMESTAMP");
});
