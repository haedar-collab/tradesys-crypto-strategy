import test from "node:test";
import assert from "node:assert/strict";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import {
  BINANCE_SPOT_DASHBOARD_CLI_USAGE,
  parseBinanceSpotDashboardCliArgs
} from "../src/paper/binance-spot-dashboard-cli-config.js";

test("CLI requires an explicit ledger and applies safe defaults", () => {
  assert.throws(() => parseBinanceSpotDashboardCliArgs([]), /--ledger is required/);
  const config = parseBinanceSpotDashboardCliArgs(["--ledger", join(tmpdir(), "paper.jsonl")]);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 8787);
  assert.equal(config.maxQuoteAgeMs, 5000);
  assert.equal(config.selectedSymbol, "BTCUSDT");
  assert.deepEqual(config.symbols, ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"]);
  assert.equal(isAbsolute(config.filePath), true);
});

test("CLI permits explicit loopback and a validated custom symbol set", () => {
  const config = parseBinanceSpotDashboardCliArgs([
    "--ledger", "./var/test.jsonl",
    "--host", "::1",
    "--port", "0",
    "--symbols", "btcusdt,ethusdt",
    "--selected-symbol", "ETHUSDT",
    "--max-quote-age-ms", "12000"
  ]);
  assert.equal(config.host, "::1");
  assert.equal(config.port, 0);
  assert.deepEqual(config.symbols, ["BTCUSDT", "ETHUSDT"]);
  assert.equal(config.selectedSymbol, "ETHUSDT");
  assert.equal(config.maxQuoteAgeMs, 12000);
});

test("CLI rejects public bind, malformed port, duplicate and excessive symbols", () => {
  const base = ["--ledger", "./var/paper.jsonl"];
  assert.throws(() => parseBinanceSpotDashboardCliArgs([...base, "--host", "0.0.0.0"]), /public binding|loopback/);
  assert.throws(() => parseBinanceSpotDashboardCliArgs([...base, "--port", "65536"]), /port/);
  assert.throws(() => parseBinanceSpotDashboardCliArgs([...base, "--port", "8.5"]), /integer/);
  assert.throws(() => parseBinanceSpotDashboardCliArgs([...base, "--symbols", "BTCUSDT,BTCUSDT"]), /unique/);
  assert.throws(() => parseBinanceSpotDashboardCliArgs([...base, "--symbols", "BTCUSDT,"]), /unique/);
  assert.throws(() => parseBinanceSpotDashboardCliArgs([...base, "--symbols", Array.from({ length: 21 }, (_, index) => "S" + String(index).padStart(2, "0")).join(",")]), /1–20/);
  assert.throws(() => parseBinanceSpotDashboardCliArgs([...base, "--symbols", "BTCUSDT,ETHUSDT", "--selected-symbol", "SOLUSDT"]), /included/);
});

test("CLI rejects unknown, duplicate, and valueless options", () => {
  assert.throws(() => parseBinanceSpotDashboardCliArgs(["--ledger"]), /missing value/);
  assert.throws(() => parseBinanceSpotDashboardCliArgs(["--ledger", "a", "--ledger", "b"]), /duplicate/);
  assert.throws(() => parseBinanceSpotDashboardCliArgs(["--ledger", "a", "--unknown"]), /unknown/);
});

test("CLI help is explicit and includes the no-live-orders boundary", () => {
  const config = parseBinanceSpotDashboardCliArgs(["--help"]);
  assert.equal(config.help, true);
  assert.match(BINANCE_SPOT_DASHBOARD_CLI_USAGE, /PAPER_ONLY/);
  assert.match(BINANCE_SPOT_DASHBOARD_CLI_USAGE, /never submits exchange orders/);
});


test("CLI allows remote bind only with explicit opt-in and strong credentials", () => {
  const keys = ["TRADESYS_ALLOW_REMOTE", "TRADESYS_DASHBOARD_USER", "TRADESYS_DASHBOARD_PASSWORD"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.TRADESYS_ALLOW_REMOTE = "true";
    process.env.TRADESYS_DASHBOARD_USER = "owner";
    process.env.TRADESYS_DASHBOARD_PASSWORD = "p".repeat(32);
    const config = parseBinanceSpotDashboardCliArgs([
      "--ledger", "./var/paper.jsonl", "--host", "0.0.0.0", "--port", "10000"
    ]);
    assert.equal(config.host, "0.0.0.0");
    assert.equal(config.auth.username, "owner");
    assert.equal(config.auth.password.length, 32);
    process.env.TRADESYS_DASHBOARD_PASSWORD = "short";
    assert.throws(() => parseBinanceSpotDashboardCliArgs([
      "--ledger", "./var/paper.jsonl", "--host", "0.0.0.0"
    ]), /minimum 24 characters/);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("remote binding failure names the unmet requirement without echoing secrets", async () => {
  const { parseBinanceSpotDashboardCliArgs } = await import("../src/paper/binance-spot-dashboard-cli-config.js");
  const saved = { ...process.env };
  try {
    process.env.TRADESYS_ALLOW_REMOTE = "true";
    process.env.TRADESYS_DASHBOARD_USER = "owner";
    process.env.TRADESYS_DASHBOARD_PASSWORD = "short-pass1";
    let message = "";
    try { parseBinanceSpotDashboardCliArgs(["--ledger", "./x.jsonl", "--host", "0.0.0.0"]); }
    catch (error) { message = error.message; }
    assert.match(message, /^public binding requires/);
    assert.match(message, /TRADESYS_DASHBOARD_PASSWORD has 11 characters; at least 24 are required/);
    assert.doesNotMatch(message, /short-pass1/);
  } finally {
    for (const key of ["TRADESYS_ALLOW_REMOTE", "TRADESYS_DASHBOARD_USER", "TRADESYS_DASHBOARD_PASSWORD"]) {
      if (key in saved) process.env[key] = saved[key]; else delete process.env[key];
    }
  }
});
