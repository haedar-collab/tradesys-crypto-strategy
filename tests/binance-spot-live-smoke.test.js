import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("live smoke script checks the five configured Spot symbols without credentials or orders", async () => {
  const source = await readFile(new URL("../scripts/binance-spot-live-smoke.js", import.meta.url), "utf8");
  for (const symbol of ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"]) assert.ok(source.includes(symbol));
  assert.match(source, /globalThis\.WebSocket/);
  assert.match(source, /validateBinanceSpotQuote/);
  assert.ok(source.includes("feed?.stop()"));
  assert.doesNotMatch(source, /apiKey|apiSecret|createOrder|order\(/i);
});

test("manual live smoke workflow uses Node 22 and no secrets", async () => {
  const source = await readFile(new URL("../.github/workflows/binance-spot-live-smoke.yml", import.meta.url), "utf8");
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /node-version: 22/);
  assert.match(source, /node scripts\/binance-spot-live-smoke\.js/);
  assert.doesNotMatch(source, /secrets\./i);
});
