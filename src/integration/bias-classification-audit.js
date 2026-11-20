/**
 * Read-only decomposition of Weekly/Daily bias classification.
 * Mirrors classifyContextBias without changing production strategy rules.
 */
const sign = value => !Number.isFinite(value) ? "missing" : value > 0 ? "positive" : value < 0 ? "negative" : "zero";
function increment(target, key) { target[key] = (target[key] ?? 0) + 1; }
export function classifyBiasEvidence(evidence) {
  const event = sign(evidence?.eventTrend);
  const ema = sign(evidence?.ema50VsEma200);
  let result = "Neutral";
  let reason = "STRUCTURE_TREND_ZERO";
  if (event === "missing" || ema === "missing") {
    result = "Neutral"; reason = "INSUFFICIENT_BIAS_EVIDENCE";
  } else if (event === "positive" && ema === "positive") {
    result = "Bullish"; reason = "STRUCTURE_AND_EMA_BULLISH";
  } else if (event === "negative" && ema === "negative") {
    result = "Bearish"; reason = "STRUCTURE_AND_EMA_BEARISH";
  } else if (event !== "zero") {
    result = "Mixed"; reason = "STRUCTURE_EMA_DISAGREEMENT";
  }
  return { result, reason, eventTrendSign: event, emaSpreadSign: ema,
    priceVsEma50Sign: sign(evidence?.closeVsEma50),
    priceVsEma200Sign: sign(evidence?.closeVsEma200) };
}
export function auditBiasClassification(diagnostics) {
  if (!diagnostics || !Array.isArray(diagnostics.rows)) throw new TypeError("diagnostics.rows must be an array");
  const output = {};
  for (const timeframe of ["weekly", "daily"]) {
    const resultCounts = {}, reasonCounts = {}, componentCounts = {};
    let evaluated = 0;
    for (const row of diagnostics.rows) {
      if (!row.contextReady || !row.timeframeEvidence?.[timeframe]) continue;
      const evidence = row.timeframeEvidence[timeframe];
      const classified = classifyBiasEvidence(evidence);
      evaluated++;
      increment(resultCounts, classified.result);
      increment(reasonCounts, classified.reason);
      increment(componentCounts, `structure:${classified.eventTrendSign}`);
      increment(componentCounts, `ema50_vs_ema200:${classified.emaSpreadSign}`);
      increment(componentCounts, `price_vs_ema50:${classified.priceVsEma50Sign}`);
      increment(componentCounts, `price_vs_ema200:${classified.priceVsEma200Sign}`);
    }
    output[timeframe] = { evaluated, resultCounts, reasonCounts, componentCounts };
  }
  return { status: "COMPLETE", method: "read-only-bias-component-audit-v1", timeframes: output,
    limitations: ["Reproduces the current bias classifier; it does not validate whether its rules are economically predictive",
      "No strategy thresholds or entry rules are changed", "Only context-ready diagnostic rows are included"] };
}
