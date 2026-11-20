import { runControlledAblation } from "./controlled-ablation.js";

const VALID_REGIMES = new Set(["BULLISH", "BEARISH", "SIDEWAYS"]);
export function runMultiRegimeAblation({ trainingByRegime, scenarios, scenarioBuilder, backtestRunner, minBars = 100, minTrades = 10 }) {
  if (!trainingByRegime || typeof trainingByRegime !== "object" || Array.isArray(trainingByRegime)) throw new TypeError("trainingByRegime is required");
  if (!Number.isInteger(minBars) || minBars < 2 || !Number.isInteger(minTrades) || minTrades < 0) throw new RangeError("invalid minimum sample thresholds");
  const regimes = Object.keys(trainingByRegime);
  if (regimes.length !== 3 || regimes.some(r => !VALID_REGIMES.has(r))) throw new TypeError("provide exactly BULLISH, BEARISH, and SIDEWAYS training folds");
  const results = {};
  for (const regime of ["BULLISH", "BEARISH", "SIDEWAYS"]) {
    const fold = trainingByRegime[regime];
    if (!fold || !Array.isArray(fold.bars) || fold.bars.length < minBars) throw new RangeError(regime + " fold has fewer than minBars");
    const result = runControlledAblation({
      trainingInput: fold,
      scenarios,
      scenarioBuilder: (training, config) => scenarioBuilder({ regime, training, config }),
      backtestRunner
    });
    results[regime] = {
      ...result,
      sample: { barCount: fold.bars.length, minBars, tradeThreshold: minTrades },
      warnings: result.results.flatMap(s => s.metrics.tradeCount < minTrades
        ? [s.name + ": trade count below minimum threshold; metrics are low-confidence"]
        : [])
    };
  }
  return {
    status: "COMPLETE",
    scope: "TRAINING_ONLY",
    regimes: results,
    crossRegime: {
      scenarioNames: scenarios.map(s => s.name),
      holdoutUsed: false,
      regimeLabelsMustBeAssignedCausally: true,
      warning: "Results are comparable only if regime labels are causal, folds are non-overlapping, and simulator assumptions are identical."
    }
  };
}
