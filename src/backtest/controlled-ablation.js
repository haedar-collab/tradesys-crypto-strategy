/**
 * Controlled training-fold ablation harness.
 * scenarioBuilder must rebuild causal signals from trainingInput for each config.
 * The same event or portfolio simulator evaluates every scenario.
 */
const REQUIRED = ["netReturnPct", "maxDrawdownPct", "tradeCount"];
const clone = value => structuredClone(value);
function validateResult(result, label) {
  if (!result || result.status !== "COMPLETE") throw new Error(label + ": backtest did not complete");
  for (const key of REQUIRED) if (!Number.isFinite(result[key])) throw new TypeError(label + ": result missing finite " + key);
}
export function runControlledAblation({ trainingInput, scenarios, scenarioBuilder, backtestRunner }) {
  if (!trainingInput || typeof trainingInput !== "object" || Array.isArray(trainingInput)) throw new TypeError("trainingInput is required");
  if (typeof scenarioBuilder !== "function") throw new TypeError("scenarioBuilder must rebuild causal scenario input");
  if (typeof backtestRunner !== "function") throw new TypeError("backtestRunner must be the selected event or portfolio simulator");
  if (!Array.isArray(scenarios) || scenarios.length < 2 || scenarios.some(s => !s || typeof s.name !== "string" || !s.name.trim() || !s.config || typeof s.config !== "object")) throw new TypeError("at least two named scenarios with configs are required");
  if (new Set(scenarios.map(s => s.name)).size !== scenarios.length) throw new RangeError("scenario names must be unique");
  const results = scenarios.map(({ name, config }) => {
    const input = scenarioBuilder(clone(trainingInput), clone(config));
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError(name + ": scenarioBuilder must return backtest input");
    const result = backtestRunner(input);
    validateResult(result, name);
    return { name, config: clone(config), metrics: {
      netReturnPct: result.netReturnPct, maxDrawdownPct: result.maxDrawdownPct,
      tradeCount: result.tradeCount,
      winRatePct: Number.isFinite(result.winRatePct) ? result.winRatePct : null,
      profitFactor: Number.isFinite(result.profitFactor) ? result.profitFactor : null,
      endingEquity: Number.isFinite(result.endingEquity) ? result.endingEquity : null
    }};
  });
  const baseline = results.find(r => scenarios.find(s => s.name === r.name)?.config?.role === "baseline");
  if (!baseline) throw new TypeError("one scenario config must declare role: baseline");
  return {
    status: "COMPLETE", scope: "TRAINING_ONLY", baseline: baseline.name, scenarioCount: results.length,
    results: results.map(r => ({ ...r, deltaVsBaseline: {
      netReturnPct: r.metrics.netReturnPct - baseline.metrics.netReturnPct,
      maxDrawdownPct: r.metrics.maxDrawdownPct - baseline.metrics.maxDrawdownPct,
      tradeCount: r.metrics.tradeCount - baseline.metrics.tradeCount
    }})),
    controls: { scenarioBuilderRebuildsSignals: true, sameBacktestRunnerForAllScenarios: true,
      holdoutProvidedToHarness: false,
      interpretation: "Descriptive training-fold comparison only; not evidence of out-of-sample profitability." }
  };
}
