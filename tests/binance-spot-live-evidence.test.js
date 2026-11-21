import test from "node:test";
import assert from "node:assert/strict";
import {
  validateBinanceSpotLiveEvidence,
  BINANCE_SPOT_LIVE_EVIDENCE_SYMBOLS
} from "../src/data/binance-spot-live-evidence.js";

function report() {
  const requestedSymbols = [...BINANCE_SPOT_LIVE_EVIDENCE_SYMBOLS];
  return {
    test: "BINANCE_SPOT_PUBLIC_WEBSOCKET_SMOKE",
    checkedAt: "2026-11-21T09:00:00.000Z",
    requestedSymbols,
    passed: requestedSymbols.map(symbol => ({
      symbol, bid: 100, ask: 101, spread: 1, ageMs: 250,
      eventTimeBasis: "LOCAL_RECEIVE_TIME",
      source: "BINANCE_SPOT_WS_BOOK_TICKER"
    })),
    failed: [],
    success: true
  };
}

test("accepts a complete fresh five-symbol WebSocket evidence report", () => {
  const result = validateBinanceSpotLiveEvidence(report());
  assert.equal(result.accepted, true);
  assert.equal(result.status, "ACCEPTED");
  assert.equal(result.symbols.length, 5);
});

test("rejects failed, missing, duplicate, and unexpected symbol results", () => {
  const failed = report(); failed.failed = ["XRPUSDT timeout"];
  assert.equal(validateBinanceSpotLiveEvidence(failed).reasons[0], "ONE_OR_MORE_SYMBOLS_FAILED");
  const missing = report(); missing.passed.pop();
  assert.equal(validateBinanceSpotLiveEvidence(missing).reasons[0], "PASS_COUNT_MISMATCH");
  const duplicate = report(); duplicate.passed[4].symbol = "BTCUSDT";
  assert.equal(validateBinanceSpotLiveEvidence(duplicate).reasons[0], "DUPLICATE_SYMBOL");
  const unexpected = report(); unexpected.passed[4].symbol = "DOGEUSDT";
  assert.equal(validateBinanceSpotLiveEvidence(unexpected).reasons[0], "UNEXPECTED_SYMBOL");
});

test("rejects stale quotes, invalid books, and source spoofing", () => {
  const stale = report(); stale.passed[0].ageMs = 10_001;
  assert.equal(validateBinanceSpotLiveEvidence(stale).reasons[0], "STALE_OR_INVALID_QUOTE_AGE");
  const crossed = report(); crossed.passed[0].ask = 99;
  assert.equal(validateBinanceSpotLiveEvidence(crossed).reasons[0], "INVALID_BID_ASK");
  const spoofed = report(); spoofed.passed[0].source = "REST";
  assert.equal(validateBinanceSpotLiveEvidence(spoofed).reasons[0], "UNTRUSTED_QUOTE_SOURCE");
});

test("rejects timestamp and report identity inconsistencies", () => {
  const wrongType = report(); wrongType.test = "OTHER";
  assert.equal(validateBinanceSpotLiveEvidence(wrongType).reasons[0], "REPORT_TYPE_MISMATCH");
  const badDate = report(); badDate.checkedAt = "yesterday";
  assert.equal(validateBinanceSpotLiveEvidence(badDate).reasons[0], "INVALID_CHECKED_AT");
  const notSuccessful = report(); notSuccessful.success = false;
  assert.equal(validateBinanceSpotLiveEvidence(notSuccessful).reasons[0], "REPORT_NOT_MARKED_SUCCESS");
});
