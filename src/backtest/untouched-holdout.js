/**
 * Final untouched holdout evaluation.
 * No parameter selection or tuning occurs in this module.
 */
function validateInput(input) {
  if (Array.isArray(input?.bars)) return { bars: input.bars, kind: "single" };
  if (input?.assets && typeof input.assets === "object" && !Array.isArray(input.assets)) {
    const symbols = Object.keys(input.assets);
    if (!symbols.length) throw new TypeError("holdout portfolio requires assets");
    const bars = input.assets[symbols[0]]?.bars;
    if (!Array.isArray(bars)) throw new TypeError("holdout assets require bars");
    for (const symbol of symbols) {
      const series = input.assets[symbol]?.bars;
      if (!Array.isArray(series) || series.length !== bars.length ||
          series.some((bar, i) => bar?.t !== bars[i]?.t)) {
        throw new RangeError("holdout assets must have aligned timestamps");
      }
    }
    return { bars, kind: "portfolio" };
  }
  throw new TypeError("holdout input must contain bars or portfolio assets");
}

function copySlice(input, kind, start, end, parameters) {
  if (kind === "single") {
    const signals = input.signals;
    if (!Array.isArray(signals)) throw new TypeError("holdout signals must be an array");
    return { ...input, ...parameters, bars: input.bars.slice(start, end),
      signals: signals.filter(s => Number.isInteger(s.index) && s.index >= start && s.index < end - 1)
        .map(s => ({ ...s, index: s.index - start, plan: s.plan ? { ...s.plan } : s.plan })) };
  }
  const assets = {};
  for (const [symbol, asset] of Object.entries(input.assets)) {
    if (!Array.isArray(asset.signals)) throw new TypeError(`${symbol}: holdout signals must be an array`);
    assets[symbol] = { ...asset, bars: asset.bars.slice(start, end),
      signals: asset.signals.filter(s => Number.isInteger(s.index) && s.index >= start && s.index < end - 1)
        .map(s => ({ ...s, index: s.index - start, plan: s.plan ? { ...s.plan } : s.plan })) };
  }
  return { ...input, ...parameters, assets };
}

/**
 * options: { runner, start, end, frozenParameters, selectionLocked, selectionTimestamp }
 * Caller must explicitly attest that parameters were frozen before the holdout began.
 */
export function runUntouchedHoldout(input, options = {}) {
  const { runner, start, end, frozenParameters, selectionLocked, selectionTimestamp } = options;
  if (typeof runner !== "function") throw new TypeError("holdout runner function is required");
  if (!frozenParameters || typeof frozenParameters !== "object" || Array.isArray(frozenParameters))
    throw new TypeError("frozenParameters object is required");
  if (selectionLocked !== true) throw new Error("holdout blocked: parameter selection must be locked");
  if (!Number.isFinite(selectionTimestamp)) throw new TypeError("selectionTimestamp is required");
  const { bars, kind } = validateInput(input);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end <= start + 1 || end > bars.length)
    throw new RangeError("invalid untouched holdout bounds");
  if (bars[start]?.t <= selectionTimestamp)
    throw new RangeError("holdout must begin strictly after parameter selection was frozen");
  const sample = copySlice(input, kind, start, end, frozenParameters);
  const result = runner(sample);
  if (!result || !Number.isFinite(result.netReturnPct) || !Number.isFinite(result.maxDrawdownPct))
    throw new TypeError("holdout runner must return finite netReturnPct and maxDrawdownPct");
  return {
    status: "COMPLETE",
    holdout: { start, endExclusive: end, startTimestamp: bars[start].t, endTimestamp: bars[end - 1].t },
    parameterSelection: { locked: true, frozenParameters: { ...frozenParameters }, selectionTimestamp },
    result: { netReturnPct: result.netReturnPct, maxDrawdownPct: result.maxDrawdownPct,
      tradeCount: result.tradeCount ?? 0, profitFactor: result.profitFactor ?? null,
      endingEquity: result.endingEquity ?? null, winRatePct: result.winRatePct ?? null },
    assumptions: {
      noRetuning: "this module performs exactly one evaluation and exposes no candidate-selection interface",
      chronology: "holdout starts strictly after the timestamp at which parameters were frozen",
      limitations: "validity still depends on causal signal generation, realistic costs, data quality, and caller honesty about the selection lock"
    }
  };
}
