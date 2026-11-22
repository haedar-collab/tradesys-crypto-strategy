#!/usr/bin/env node
/**
 * Build a strategy acceptance report from public Binance Spot history.
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/build-acceptance-report.mjs \
 *     [--symbols BTCUSDT,ETHUSDT,...] [--start 2022-01-01] [--end ISO] \
 *     [--folds 6] [--out research/acceptance/strategy-acceptance-report.json]
 *
 * Read-only public market data (data-api.binance.vision); no API keys, no orders.
 */
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { replayCandidates, buildAcceptanceEvidence, assessDataQuality } from "../src/validation/acceptance-evidence.js";
import { evaluateStrategyAcceptance } from "../src/validation/strategy-acceptance.js";
import { STRATEGY_ENGINE_VERSION } from "../src/engine/multi-timeframe.js";
import { BINANCE_SPOT_SCREENER_LOOKBACK_BARS } from "../src/screener/binance-spot-mtf-screener.js";

const BASE = "https://data-api.binance.vision";
const STEP = { "1w": 604_800_000, "1d": 86_400_000, "4h": 14_400_000, "1h": 3_600_000 };

if (!isMainThread) {
  const { timeframes, start, end } = workerData;
  const result = replayCandidates(timeframes, { start, end });
  parentPort.postMessage(result);
} else {
  await main();
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function fetchKlines(symbol, interval, startTime, endTime) {
  const rows = [];
  let cursor = startTime;
  while (cursor < endTime) {
    const url = new URL(BASE + "/api/v3/klines");
    url.search = new URLSearchParams({ symbol, interval, startTime: String(cursor), endTime: String(endTime - 1), limit: "1000" });
    let response;
    for (let attempt = 1; ; attempt++) {
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
        if (response.ok) break;
        if (attempt >= 4 || ![418, 429, 500, 502, 503, 504].includes(response.status)) throw new Error("HTTP " + response.status);
      } catch (error) { if (attempt >= 4) throw error; }
      await new Promise(r => setTimeout(r, 1_000 * 2 ** attempt));
    }
    const batch = await response.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const r of batch) {
      const candle = { openTime: +r[0], closeTime: +r[6], open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] };
      if (candle.closeTime < endTime && (!rows.length || candle.openTime > rows.at(-1).openTime)) rows.push(candle);
    }
    const next = +batch.at(-1)[0] + STEP[interval];
    if (next <= cursor) throw new Error("pagination did not advance");
    cursor = next;
    if (batch.length < 1000) break;
  }
  return rows;
}

async function main() {
  const symbols = arg("--symbols", "BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT").split(",").map(s => s.trim().toUpperCase());
  const start = Date.parse(arg("--start", "2022-01-01T00:00:00Z"));
  const end = arg("--end") ? Date.parse(arg("--end")) : Math.floor(Date.now() / STEP["1h"]) * STEP["1h"];
  const folds = Number(arg("--folds", "6"));
  const out = resolve(arg("--out", "research/acceptance/strategy-acceptance-report.json"));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("invalid --start/--end");
  const log = m => process.stderr.write("[acceptance] " + m + "\n");
  const t0 = Date.now();

  const data = {};
  for (const symbol of symbols) {
    data[symbol] = {
      weekly: await fetchKlines(symbol, "1w", Date.UTC(2015, 0, 1), end),
      daily: await fetchKlines(symbol, "1d", Date.UTC(2015, 0, 1), end),
      h4: await fetchKlines(symbol, "4h", start - 400 * STEP["4h"], end),
      h1: await fetchKlines(symbol, "1h", start - 400 * STEP["1h"], end)
    };
    log(symbol + ": " + Object.entries(data[symbol]).map(([k, v]) => k + "=" + v.length).join(" "));
  }
  const benchmarkDaily = symbols.includes("BTCUSDT") ? data.BTCUSDT.daily : await fetchKlines("BTCUSDT", "1d", Date.UTC(2015, 0, 1), end);

  const dataQuality = assessDataQuality(symbols.flatMap(symbol => [
    { symbol, interval: "1h", candles: data[symbol].h1, from: start, to: end },
    { symbol, interval: "4h", candles: data[symbol].h4, from: start, to: end },
    { symbol, interval: "1d", candles: data[symbol].daily, from: start, to: end }
  ]));
  log("data quality: " + dataQuality.status);

  // Causal replays in parallel (one worker per symbol).
  const replays = await Promise.all(symbols.map(symbol => new Promise((resolveWorker, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { timeframes: data[symbol], start, end } });
    worker.once("message", result => { log(symbol + ": " + result.stats.computed + " evaluations computed, " +
      result.stats.skippedByDailyGate + " skipped by daily gate, " + result.stats.candidates + " candidates"); resolveWorker(result); });
    worker.once("error", reject);
  })));

  const evidence = buildAcceptanceEvidence({
    symbols: symbols.map((symbol, i) => ({ symbol, h1: data[symbol].h1, decisions: replays[i].decisions })),
    start, end, folds, benchmarkDaily, dataQuality
  });
  const decision = evaluateStrategyAcceptance(evidence);
  const digest = createHash("sha256").update(JSON.stringify(Object.fromEntries(symbols.map(s => [s,
    Object.fromEntries(Object.entries(data[s]).map(([k, v]) => [k, [v.length, v[0]?.openTime, v.at(-1)?.closeTime, v.at(-1)?.close]]))])))).digest("hex");

  const report = {
    ...evidence,
    evaluatedAt: new Date().toISOString(),
    provenance: {
      source: BASE + "/api/v3/klines (public Binance Spot market data)",
      symbols, period: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
      strategyEngineVersion: STRATEGY_ENGINE_VERSION, lookbackBars: BINANCE_SPOT_SCREENER_LOOKBACK_BARS,
      evaluation: "causal replay at every closed H1 bar; entry at next H1 open",
      execution: { initialCapitalPerSymbol: 10_000, riskPct: 1, feeBps: 10, slippageBps: 5, positionConcurrencyPerSymbol: 1 },
      parameterFitting: "NONE: fixed engine defaults; no parameter was tuned on this data by this pipeline",
      datasetFingerprintSha256: digest,
      replayStats: Object.fromEntries(symbols.map((s, i) => [s, replays[i].stats])),
      runtimeSeconds: Math.round((Date.now() - t0) / 1000)
    },
    acceptance: { decision: decision.decision, eligibleForPaperTrading: decision.eligibleForPaperTrading,
      failures: decision.failures, missingEvidence: decision.missingEvidence, warnings: decision.warnings,
      checks: decision.checks },
    limitations: [
      "Out-of-sample here means no parameter fitting in this pipeline; the strategy rules themselves may have been designed with knowledge of past markets.",
      "Equal-weight portfolio of independent per-symbol sub-accounts; maxDrawdownPct is the worst per-symbol marked drawdown (upper bound for the portfolio).",
      "OHLC event simulation with conservative same-bar ordering; no order-book depth, partial fills or exchange filters.",
      "Bootstrap quantiles assume exchangeable blocks of trades; they are diagnostics, not guarantees."
    ]
  };
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2) + "\n");
  log("decision: " + decision.decision + " -> " + out + " (" + report.provenance.runtimeSeconds + " s)");
}
