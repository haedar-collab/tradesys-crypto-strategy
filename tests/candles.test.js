import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCandles, toSeries } from "../src/validation/candles.js";

const row = (openTime, closeTime, close = 10) => [openTime, "9", "11", "8", String(close), "100", closeTime, "1000"];

test("normalizes valid Binance klines and maps series", () => {
  const result = normalizeCandles([row(0, 59_999), row(60_000, 119_999)], { now: 180_000, intervalMs: 60_000, requireContiguous: true });
  assert.equal(result.status, "PASS");
  assert.equal(result.candles.length, 2);
  assert.deepEqual(toSeries(result.candles).c, [10, 10]);
});

test("excludes forming candles from confirmed analysis", () => {
  const result = normalizeCandles([row(0, 59_999), row(60_000, 119_999)], { now: 100_000 });
  assert.equal(result.candles.length, 1);
  assert.equal(result.status, "WARN");
  assert.equal(result.warnings[0].code, "KLINE_FORMING_EXCLUDED");
});

test("rejects malformed OHLC and negative volume", () => {
  const badPrice = [0, "9", "8", "7", "10", "100", 59_999, "1000"];
  const badVolume = [60_000, "9", "11", "8", "10", "-1", 119_999, "1000"];
  const result = normalizeCandles([badPrice, badVolume], { now: 180_000 });
  assert.equal(result.status, "FAIL");
  assert.ok(result.errors.some(e => e.code === "KLINE_OHLC_INCONSISTENT"));
  assert.ok(result.errors.some(e => e.code === "KLINE_VOLUME_NEGATIVE"));
});

test("detects duplicates and gaps", () => {
  const result = normalizeCandles([row(0, 59_999), row(0, 59_999), row(120_000, 179_999)], { now: 200_000, intervalMs: 60_000, requireContiguous: true });
  assert.ok(result.errors.some(e => e.code === "KLINE_DUPLICATE_TIME"));
  assert.ok(result.errors.some(e => e.code === "KLINE_GAP"));
});

test("rejects stale latest candle", () => {
  const result = normalizeCandles([row(0, 59_999)], { now: 200_000, maxStalenessMs: 60_000 });
  assert.equal(result.status, "FAIL");
  assert.ok(result.errors.some(e => e.code === "KLINE_STALE"));
});

test("rejects descending timestamps instead of silently sorting", () => {
  const result = normalizeCandles([row(60_000, 119_999), row(0, 59_999)], { now: 180_000 });
  assert.equal(result.status, "FAIL");
  assert.ok(result.errors.some(e => e.code === "KLINE_ORDER"));
});
