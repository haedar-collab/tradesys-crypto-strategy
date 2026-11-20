/**
 * Read-only gate analysis over causal replay diagnostics.
 * Reports independent and sequential blockers; it does not run counterfactual trades
 * or change production strategy rules.
 */
export function analyzeFilterGates(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new TypeError("rows must be a non-empty array");
  const gates = {
    weeklyProvisional: r => r.contextReady === true && r.weeklyClosed === false,
    weeklyBearish: r => r.contextReady === true && r.weekly === "Bearish",
    dailyNotBullish: r => r.contextReady === true && r.daily !== "Bullish",
    regimeUnconfirmed: r => r.contextReady === true && r.regime?.confirmed !== true,
    regimeDowntrend: r => r.contextReady === true && r.regime?.effective === "Downtrend",
    h4NotBullish: r => r.contextReady === true && r.h4Structure !== "Bullish"
  };
  const ready = rows.filter(r => r.contextReady === true);
  const independentBlockers = Object.fromEntries(Object.entries(gates).map(([name, predicate]) =>
    [name, ready.filter(predicate).length]));
  const firstBlockerCounts = {};
  for (const row of rows) {
    const first = row.contextReady === true
      ? Object.entries(gates).find(([, predicate]) => predicate(row))?.[0] ?? "passed_observed_gates"
      : row.gate ?? "context_not_ready";
    firstBlockerCounts[first] = (firstBlockerCounts[first] ?? 0) + 1;
  }
  return {
    status: "COMPLETE",
    evaluationCount: rows.length,
    contextReadyCount: ready.length,
    independentBlockers,
    firstBlockerCounts,
    caveats: [
      "Independent blockers overlap and must not be summed.",
      "Only fields present in replay rows are assessed; this is not a full engine counterfactual.",
      "No entry fills, fees, slippage, returns, or profitability are inferred."
    ]
  };
}
