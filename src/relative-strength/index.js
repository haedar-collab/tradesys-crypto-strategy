/**
 * Relative-strength scoring against BTC for Binance Spot universe screening.
 * This module is pure and deterministic. Universe retrieval, exchange filters,
 * token classification, and float-data enrichment stay in the application.
 */

import { ema, pivotsAll } from "../indicators/index.js";

export const DEFAULT_RS_PARAMETERS = Object.freeze({
  rsW30: 0.5,
  rsW7: 0.3,
  rsW90: 0.2
});

function assertSeries(series, label) {
  if (!series || !Array.isArray(series.t) || !Array.isArray(series.c) || series.t.length !== series.c.length || series.t.length < 2) {
    throw new TypeError(`${label} must contain aligned timestamp and close arrays`);
  }
  for (let i = 0; i < series.t.length; i++) {
    if (!Number.isFinite(series.t[i]) || !Number.isFinite(series.c[i]) || series.c[i] <= 0) {
      throw new TypeError(`${label} contains invalid timestamp or close at index ${i}`);
    }
    if (i && series.t[i] <= series.t[i - 1]) throw new RangeError(`${label} timestamps must be strictly increasing`);
  }
}

function ratioStructure(values) {
  const piv = pivotsAll(values, values, 3);
  const m = values.length - 1;
  const hi = piv.hi.filter(index => index <= m - 3);
  const lo = piv.lo.filter(index => index <= m - 3);
  if (hi.length < 2 || lo.length < 2) return "n/a";
  const [h1, h2] = hi.slice(-2).map(index => values[index]);
  const [l1, l2] = lo.slice(-2).map(index => values[index]);
  if (h2 > h1 && l2 > l1) return "HH-HL";
  if (h2 < h1 && l2 < l1) return "LH-LL";
  return "Mixed";
}

function weightedScore(assetCloses, benchmarkCloses, index, P) {
  const ret = (values, n) => index - n >= 0 ? (values[index] / values[index - n] - 1) * 100 : null;
  const a7 = ret(assetCloses, 7), b7 = ret(benchmarkCloses, 7);
  const a30 = ret(assetCloses, 30), b30 = ret(benchmarkCloses, 30);
  const a90 = ret(assetCloses, 90), b90 = ret(benchmarkCloses, 90);
  if ([a7, b7, a30, b30].some(value => value == null)) return null;
  const d7 = a7 - b7, d30 = a30 - b30;
  const d90 = a90 == null || b90 == null ? null : a90 - b90;
  const score = P.rsW30 * d30 + P.rsW7 * d7 + P.rsW90 * (d90 == null ? d30 : d90);
  return { d7, d30, d90, score };
}

/**
 * Computes one symbol's RS metrics.
 * Requires asset and benchmark to have matching latest timestamps and enough
 * aligned daily observations. It does not silently mix different as-of dates.
 */
export function computeRelativeStrength(asset, benchmark, parameters = {}) {
  assertSeries(asset, "asset");
  assertSeries(benchmark, "benchmark");
  const P = { ...DEFAULT_RS_PARAMETERS, ...parameters };
  const expectedIntervalMs = parameters.expectedIntervalMs ?? 86_400_000;
  if (!Number.isFinite(expectedIntervalMs) || expectedIntervalMs <= 0) throw new RangeError("expectedIntervalMs must be positive and finite");
  for (const key of ["rsW7", "rsW30", "rsW90"]) {
    if (!Number.isFinite(P[key]) || P[key] < 0) throw new RangeError(`${key} must be non-negative and finite`);
  }
  const benchmarkByTime = new Map(benchmark.t.map((time, index) => [time, benchmark.c[index]]));
  const common = asset.t.map((time, index) => ({ time, assetClose: asset.c[index], benchmarkClose: benchmarkByTime.get(time) }))
    .filter(row => row.benchmarkClose != null);
  if (common.length < 91) return { status: "WAIT_DATA", reason: "INSUFFICIENT_ALIGNED_HISTORY", observations: common.length };
  const lastAssetTime = asset.t[asset.t.length - 1], lastBenchmarkTime = benchmark.t[benchmark.t.length - 1];
  if (lastAssetTime !== lastBenchmarkTime || common[common.length - 1].time !== lastAssetTime) {
    return { status: "WAIT_DATA", reason: "AS_OF_MISMATCH", observations: common.length };
  }
  const ac = common.map(row => row.assetClose), bc = common.map(row => row.benchmarkClose);
  const index = common.length - 1;
  const current = weightedScore(ac, bc, index, P);
  const fiveDaysAgo = weightedScore(ac, bc, index - 5, P);
  const score5 = index >= 95 && fiveDaysAgo ? fiveDaysAgo.score : null;

  const ratio = ac.map((value, i) => value / bc[i]);
  const ratioEma20 = ema(ratio, 20);
  const m = ratio.length - 1;
  const ratioStruct = ratioStructure(ratio);
  const ratioUp = ratioStruct === "HH-HL" || (m > 25 && ratio[m] > ratioEma20[m] && ratioEma20[m] > ratioEma20[m - 5]);

  return {
    status: "PASS",
    observations: common.length,
    asOf: common[index].time,
    ...current,
    score5,
    ratioUp,
    ratioStruct
  };
}

/**
 * Rank an already filtered universe. Float enrichment and application-specific
 * eligibility checks are intentionally separate from this deterministic rank.
 */
export function rankRelativeStrength(items, topPercent = 20) {
  if (!Array.isArray(items)) throw new TypeError("items must be an array");
  if (!Number.isFinite(topPercent) || topPercent <= 0 || topPercent > 100) throw new RangeError("topPercent must be > 0 and <= 100");
  const valid = items.filter(item => item && item.status === "PASS" && Number.isFinite(item.score))
    .map(item => ({ ...item }))
    .sort((a, b) => b.score - a.score); // stable sort preserves incoming volume order for score ties
  const topN = valid.length ? Math.max(1, Math.ceil(valid.length * topPercent / 100)) : 0;
  return valid.map((item, index) => ({ ...item, rank: index + 1, top: index < topN }));
}
