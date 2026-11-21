import { resolve } from "node:path";
import { DEFAULT_BINANCE_SPOT_DASHBOARD_SYMBOLS } from "./binance-spot-paper-dashboard-runtime.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1"]);

function parseInteger(value, name, min, max) {
  if (!/^(0|[1-9]\d*)$/.test(value ?? "")) {
    throw new TypeError(name + " must be an integer");
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new RangeError(name + " must be between " + min + " and " + max);
  }
  return number;
}

/** Parse and validate the supported dashboard launcher command-line options. */
export function parseBinanceSpotDashboardCliArgs(argv = []) {
  if (!Array.isArray(argv) || argv.some(value => typeof value !== "string")) {
    throw new TypeError("arguments must be an array of strings");
  }
  const values = new Map();
  const flags = new Set(["--help"]);
  const valued = new Set([
    "--ledger", "--host", "--port", "--symbols",
    "--selected-symbol", "--max-quote-age-ms"
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (flags.has(token)) {
      if (values.has(token)) throw new Error("duplicate option: " + token);
      values.set(token, true);
      continue;
    }
    if (!valued.has(token)) throw new Error("unknown option: " + token);
    if (values.has(token)) throw new Error("duplicate option: " + token);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error("missing value for " + token);
    }
    values.set(token, value);
    index += 1;
  }

  if (values.has("--help")) return Object.freeze({ help: true });
  const ledger = values.get("--ledger");
  if (!ledger || ledger.trim() === "") {
    throw new Error("--ledger is required; choose a dedicated persistent ledger path");
  }

  const host = values.get("--host") ?? "127.0.0.1";
  const dashboardUsername = process.env.TRADESYS_DASHBOARD_USER;
  const dashboardPassword = process.env.TRADESYS_DASHBOARD_PASSWORD;
  const auth = dashboardUsername && dashboardPassword
    ? Object.freeze({ username: dashboardUsername, password: dashboardPassword })
    : null;
  const remoteEnabled = process.env.TRADESYS_ALLOW_REMOTE === "true";
  if (!LOOPBACK_HOSTS.has(host) && !(host === "0.0.0.0" && remoteEnabled && auth && auth.password.length >= 24)) {
    throw new Error("public binding requires TRADESYS_ALLOW_REMOTE=true, TRADESYS_DASHBOARD_USER, and TRADESYS_DASHBOARD_PASSWORD (minimum 24 characters)");
  }
  if (auth && auth.password.length < 24) {
    throw new Error("TRADESYS_DASHBOARD_PASSWORD must contain at least 24 characters");
  }
  const port = parseInteger(values.get("--port") ?? "8787", "--port", 0, 65_535);
  const maxQuoteAgeMs = parseInteger(
    values.get("--max-quote-age-ms") ?? "5000",
    "--max-quote-age-ms",
    100,
    300_000
  );
  const symbols = values.has("--symbols")
    ? values.get("--symbols").split(",").map(value => value.trim().toUpperCase())
    : [...DEFAULT_BINANCE_SPOT_DASHBOARD_SYMBOLS];

  if (symbols.length === 0 || symbols.length > 20 ||
      symbols.some(symbol => !/^[A-Z0-9]{2,20}$/.test(symbol)) ||
      new Set(symbols).size !== symbols.length) {
    throw new Error("--symbols must contain 1–20 unique comma-separated Binance symbols");
  }
  const selectedSymbol = (values.get("--selected-symbol") ?? symbols[0]).toUpperCase();
  if (!symbols.includes(selectedSymbol)) {
    throw new Error("--selected-symbol must be included in --symbols");
  }

  return Object.freeze({
    help: false,
    filePath: resolve(ledger),
    host,
    auth,
    port,
    maxQuoteAgeMs,
    symbols: Object.freeze(symbols),
    selectedSymbol
  });
}

export const BINANCE_SPOT_DASHBOARD_CLI_USAGE = `Usage:
  npm run start:dashboard -- --ledger ./var/paper-ledger.jsonl [options]

Options:
  --ledger PATH             Required persistent paper ledger path
  --host HOST               127.0.0.1 (default), ::1, or protected 0.0.0.0
  --port PORT               0–65535 (default 8787; 0 selects an ephemeral port)
  --symbols CSV             Comma-separated symbols (default BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT)
  --selected-symbol SYMBOL  Selected dashboard symbol (default first symbol)
  --max-quote-age-ms N      Quote freshness limit 100–300000 (default 5000)
  TRADESYS_ALLOW_REMOTE=true enables protected remote binding only when both dashboard credentials are set.\n  TRADESYS_DASHBOARD_USER and TRADESYS_DASHBOARD_PASSWORD are required remotely; password minimum 24 characters.\n  --help                    Show this help

This launcher is PAPER_ONLY and read-only. It never submits exchange orders.
`;
