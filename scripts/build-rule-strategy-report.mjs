#!/usr/bin/env node
/**
 * Round-2 research report for daily rule strategies (TF / MR), evaluated with
 * the unchanged acceptance gate. Protocol: research/strategy-research/PROTOCOL-ROUND-2.md
 *
 *   NODE_USE_ENV_PROXY=1 node scripts/build-rule-strategy-report.mjs --strategy TF \
 *     --set development|holdout [--out PATH]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { buildAcceptanceEvidence, assessDataQuality } from "../src/validation/acceptance-evidence.js";
import { evaluateStrategyAcceptance } from "../src/validation/strategy-acceptance.js";
import { RULE_STRATEGIES, runRuleStrategyBacktest } from "../src/backtest/rule-strategies.js";
import { BASE, fetchKlines } from "./lib/binance-history.mjs";

export const SYMBOL_SETS = Object.freeze({
  development: Object.freeze(["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"]),
  holdout: Object.freeze(["ADAUSDT", "DOGEUSDT", "LINKUSDT", "LTCUSDT", "TRXUSDT", "DOTUSDT", "AVAXUSDT", "ATOMUSDT", "ETCUSDT", "XLMUSDT"])
});
const START = Date.UTC(2019, 0, 1), END = Date.UTC(2026, 10, 22);

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };
const strategy = RULE_STRATEGIES[arg("--strategy")];
const setName = arg("--set", "development");
const symbols = SYMBOL_SETS[setName];
if (!strategy) throw new Error("--strategy must be one of " + Object.keys(RULE_STRATEGIES).join(", "));
if (!symbols) throw new Error("--set must be development or holdout");
const out = resolve(arg("--out", `research/strategy-research/round-2/${setName}-${strategy.id}.json`));
const log = m => process.stderr.write("[round-2] " + m + "\n");

const daily = {};
for (const symbol of symbols) {
  daily[symbol] = await fetchKlines(symbol, "1d", Date.UTC(2015, 0, 1), END);
  log(symbol + ": " + daily[symbol].length + " daily bars from " + new Date(daily[symbol][0].openTime).toISOString().slice(0, 10));
}
const benchmarkDaily = daily.BTCUSDT ?? await fetchKlines("BTCUSDT", "1d", Date.UTC(2015, 0, 1), END);
const dataQuality = assessDataQuality(symbols.map(symbol => ({ symbol, interval: "1d", candles: daily[symbol], from: START, to: END })));

const evidence = buildAcceptanceEvidence({
  symbols: symbols.map(symbol => ({ symbol, daily: daily[symbol] })),
  start: START, end: END, folds: 6, benchmarkDaily, dataQuality,
  runBacktest: (s, options) => runRuleStrategyBacktest(s.daily, strategy, options)
});
const decision = evaluateStrategyAcceptance(evidence);
const fingerprint = createHash("sha256").update(JSON.stringify(symbols.map(s =>
  [s, daily[s].length, daily[s][0]?.openTime, daily[s].at(-1)?.closeTime, daily[s].at(-1)?.close]))).digest("hex");
const report = {
  ...evidence,
  evaluatedAt: new Date().toISOString(),
  provenance: {
    protocol: "research/strategy-research/PROTOCOL-ROUND-2.md", strategy, set: setName, symbols,
    source: BASE + "/api/v3/klines (public Binance Spot daily bars)",
    period: { start: new Date(START).toISOString(), end: new Date(END).toISOString() },
    execution: { initialCapitalPerSymbol: 10_000, riskPct: 1, feeBps: 10, slippageBps: 5, stress: "20/20 bps" },
    parameterFitting: "NONE: textbook parameters fixed in the pre-registered protocol",
    datasetFingerprintSha256: fingerprint
  },
  acceptance: { decision: decision.decision, eligibleForPaperTrading: decision.eligibleForPaperTrading,
    failures: decision.failures, missingEvidence: decision.missingEvidence, checks: decision.checks }
};
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(report, null, 2) + "\n");
log(strategy.id + " on " + setName + ": " + decision.decision + " -> " + out);
