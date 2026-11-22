#!/usr/bin/env node
/**
 * Round-3 research report: TF-R on a shared-capital portfolio, evaluated with
 * the unchanged acceptance gate. Protocol: research/strategy-research/PROTOCOL-ROUND-3.md
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/build-round3-report.mjs --set development|holdout
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { buildAcceptanceEvidence, assessDataQuality } from "../src/validation/acceptance-evidence.js";
import { evaluateStrategyAcceptance } from "../src/validation/strategy-acceptance.js";
import { runRulePortfolioBacktest, TF_R } from "../src/backtest/rule-portfolio.js";
import { BASE, fetchKlines } from "./lib/binance-history.mjs";

export const ROUND3_SETS = Object.freeze({
  development: Object.freeze(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT", "LINKUSDT",
    "LTCUSDT", "TRXUSDT", "DOTUSDT", "AVAXUSDT", "ATOMUSDT", "ETCUSDT", "XLMUSDT"]),
  holdout: Object.freeze(["BCHUSDT", "NEOUSDT", "VETUSDT", "ALGOUSDT", "XTZUSDT", "HBARUSDT", "FILUSDT", "NEARUSDT",
    "UNIUSDT", "AAVEUSDT", "SANDUSDT", "ZECUSDT"])
});
const START = Date.UTC(2019, 0, 1), END = Date.UTC(2026, 10, 22), CAPITAL = 100_000;
const arg = (n, f) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : f; };
const setName = arg("--set", "development");
const requested = ROUND3_SETS[setName];
if (!requested) throw new Error("--set must be development or holdout");
const out = resolve(arg("--out", `research/strategy-research/round-3/${setName}-TF-R.json`));
const log = m => process.stderr.write("[round-3] " + m + "\n");

const series = {}, dropped = [];
for (const symbol of requested) {
  let bars = [];
  try { bars = await fetchKlines(symbol, "1d", Date.UTC(2015, 0, 1), END); } catch (error) { log(symbol + ": fetch failed: " + error.message); }
  if (bars.length < 260 || bars.at(-1).openTime < START) { dropped.push({ symbol, reason: bars.length ? "INSUFFICIENT_DATA" : "NO_DATA" }); log(symbol + ": dropped"); continue; }
  series[symbol] = bars;
  log(symbol + ": " + bars.length + " daily bars from " + new Date(bars[0].openTime).toISOString().slice(0, 10));
}
const symbols = Object.keys(series);
const benchmarkDaily = series.BTCUSDT ?? await fetchKlines("BTCUSDT", "1d", Date.UTC(2015, 0, 1), END);
const dataQuality = assessDataQuality(symbols.map(symbol => ({ symbol, interval: "1d", candles: series[symbol], from: START, to: END })));

const evidence = buildAcceptanceEvidence({
  symbols: [{ symbol: "PORTFOLIO", series }],
  start: START, end: END, folds: 6, benchmarkDaily, dataQuality, initialCapital: CAPITAL,
  runBacktest: (s, options) => runRulePortfolioBacktest(s.series, TF_R, options)
});
const full = runRulePortfolioBacktest(series, TF_R, { from: START, to: END, initialCapital: CAPITAL });
const bySymbol = {};
for (const t of full.trades) {
  const b = bySymbol[t.symbol] ??= { symbol: t.symbol, tradeCount: 0, netPnl: 0, wins: 0, maxNotionalShare: 0 };
  b.tradeCount++; b.netPnl += t.netPnl; if (t.netPnl > 0) b.wins++;
  b.maxNotionalShare = Math.max(b.maxNotionalShare, t.notional / t.equityAtEntry);
}
const decision = evaluateStrategyAcceptance(evidence);
const fingerprint = createHash("sha256").update(JSON.stringify(symbols.map(s =>
  [s, series[s].length, series[s][0].openTime, series[s].at(-1).closeTime, series[s].at(-1).close]))).digest("hex");
const report = {
  ...evidence,
  perSymbol: Object.values(bySymbol).map(b => ({ ...b, netPnl: Number(b.netPnl.toFixed(2)),
    contributionPct: Number((b.netPnl / CAPITAL * 100).toFixed(2)) })).sort((a, b) => b.netPnl - a.netPnl),
  portfolio: { endingEquity: full.endingEquity, netReturnPct: full.netReturnPct, maxDrawdownPct: full.maxDrawdownPct,
    tradeCount: full.tradeCount, profitFactor: full.profitFactor, winRatePct: full.winRatePct },
  evaluatedAt: new Date().toISOString(),
  provenance: {
    protocol: "research/strategy-research/PROTOCOL-ROUND-3.md", candidate: TF_R, set: setName,
    symbols, droppedSymbols: dropped, source: BASE + "/api/v3/klines (public Binance Spot daily bars)",
    period: { start: new Date(START).toISOString(), end: new Date(END).toISOString() },
    execution: { sharedCapital: CAPITAL, riskPct: 1, maxPositionPct: TF_R.maxPositionPct, leverage: "none",
      feeBps: 10, slippageBps: 5, stress: "20/20 bps", drawdown: "combined marked equity at daily closes" },
    parameterFitting: "NONE: all parameters fixed in the pre-registered protocol", datasetFingerprintSha256: fingerprint
  },
  acceptance: { decision: decision.decision, eligibleForPaperTrading: decision.eligibleForPaperTrading,
    failures: decision.failures, missingEvidence: decision.missingEvidence, checks: decision.checks }
};
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(report, null, 2) + "\n");
log("TF-R on " + setName + ": " + decision.decision + " -> " + out);
