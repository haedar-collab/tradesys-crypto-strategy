/** Read-only audit of Weekly/Daily bias evidence. Does not alter strategy rules. */
export function auditBiasRootCause(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new TypeError("rows must be a non-empty array");
  const counts = { weekly: {}, daily: {}, regime: {}, h4Structure: {}, reasons: {} };
  const inc = (map, key) => { const k = key == null ? "unknown" : String(key); map[k] = (map[k] ?? 0) + 1; };
  for (const row of rows) {
    if (row.contextReady !== true) { inc(counts.reasons, row.gate ?? "CONTEXT_NOT_READY"); continue; }
    inc(counts.weekly, row.weekly);
    inc(counts.daily, row.daily);
    inc(counts.regime, row.regime?.effective);
    inc(counts.h4Structure, row.h4Structure);
    inc(counts.reasons, row.gate);
  }
  const ready = rows.filter(r => r.contextReady === true);
  const mismatch = ready.filter(r => r.weekly !== "Bullish" || r.daily !== "Bullish" || r.regime?.effective === "Downtrend");
  return {
    status: "COMPLETE",
    evaluationCount: rows.length,
    contextReadyCount: ready.length,
    distributions: counts,
    nonBullishContextCount: mismatch.length,
    interpretation: "Descriptive evidence only. This audit does not change bias classification, entry gates, or strategy parameters.",
    limitations: ["Counts are conditional on supplied replay rows", "First blocking gate may hide later blockers", "No trade fills, costs, returns, or profitability inference"]
  };
}
