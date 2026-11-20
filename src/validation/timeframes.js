/**
 * Strict as-of validator for multi-timeframe strategy inputs.
 * asOf is the close timestamp of the latest fully closed candle in each context.
 */
const DEFAULT_MAX_AGE_MS = Object.freeze({
  weekly: 8 * 86_400_000,
  daily: 2 * 86_400_000,
  h4: 8 * 3_600_000,
  h1: 2 * 3_600_000
});

export function validateMultiTimeframeAsOf(input, options = {}) {
  const evaluationTime = options.evaluationTime;
  const maxAgeMs = { ...DEFAULT_MAX_AGE_MS, ...(options.maxAgeMs ?? {}) };
  const errors = [];
  if (!Number.isFinite(evaluationTime)) {
    return { status: "FAIL", errors: [{ code: "EVALUATION_TIME_INVALID" }] };
  }
  for (const key of ["weekly", "daily", "h4", "h1"]) {
    const context = input?.[key];
    if (!context || typeof context !== "object") {
      errors.push({ code: "TIMEFRAME_CONTEXT_MISSING", timeframe: key });
      continue;
    }
    if (context.closed !== true) {
      errors.push({ code: "TIMEFRAME_NOT_CLOSED", timeframe: key });
    }
    if (!Number.isFinite(context.asOf)) {
      errors.push({ code: "TIMEFRAME_ASOF_INVALID", timeframe: key });
      continue;
    }
    if (context.asOf > evaluationTime) {
      errors.push({ code: "TIMEFRAME_ASOF_IN_FUTURE", timeframe: key, asOf: context.asOf });
      continue;
    }
    const limit = maxAgeMs[key];
    if (!Number.isFinite(limit) || limit <= 0) {
      errors.push({ code: "MAX_AGE_INVALID", timeframe: key });
      continue;
    }
    const ageMs = evaluationTime - context.asOf;
    if (ageMs > limit) errors.push({ code: "TIMEFRAME_STALE", timeframe: key, ageMs, maxAgeMs: limit });
  }
  return { status: errors.length ? "FAIL" : "PASS", evaluationTime, errors };
}
