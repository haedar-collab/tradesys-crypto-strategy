/**
 * BTC market-regime classifier extracted from Tradesys Crypto.
 * Pure deterministic logic. Expects a prepared DAILY series from
 * prepareIndicators(); it does not fetch data or access application state.
 *
 * Regime labels deliberately preserve the legacy database values:
 * Uptrend, Sideways, Kompresi, Kapitulasi, Downtrend.
 */

import { pctRank } from "../indicators/index.js";

export const DEFAULT_REGIME_PARAMETERS = Object.freeze({
  emaSlow: 200,
  adxTrend: 25,
  adxRange: 20,
  rsiCap: 25,
  capDrop: 20,
  capVolMult: 2.5,
  compPct: 10,
  confirmBars: 2
});

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function validatePreparedSeries(p) {
  const fields = ["c", "h", "l", "v", "e20", "e50", "e200", "adx", "rsi", "bbw", "atrp"];
  if (!p || !Number.isInteger(p.n) || p.n < 0 || fields.some(key => !Array.isArray(p[key]) || p[key].length !== p.n)) {
    throw new TypeError("Prepared series must contain aligned c/h/l/v/e20/e50/e200/adx/rsi/bbw/atrp arrays and n");
  }
  if (!p.piv || !Array.isArray(p.piv.hi) || !Array.isArray(p.piv.lo)) {
    throw new TypeError("Prepared series must include numeric pivot arrays { hi, lo }");
  }
}

export function structureAt(p, index) {
  validatePreparedSeries(p);
  if (!Number.isInteger(index) || index < 0 || index >= p.n) throw new RangeError("index out of range");
  // Keep the exact legacy confirmation filter pending a dedicated bar-by-bar audit.
  const hi = p.piv.hi.filter(x => x <= index - 3);
  const lo = p.piv.lo.filter(x => x <= index - 3);
  if (hi.length < 2 || lo.length < 2) return "n/a";
  const [h1, h2] = hi.slice(-2).map(x => p.h[x]);
  const [l1, l2] = lo.slice(-2).map(x => p.l[x]);
  if (h2 > h1 && l2 > l1) return "HH-HL";
  if (h2 < h1 && l2 < l1) return "LH-LL";
  return "Mixed";
}

export function classifyRegimeAt(p, index, parameters = {}) {
  validatePreparedSeries(p);
  if (!Number.isInteger(index) || index < 0 || index >= p.n) throw new RangeError("index out of range");
  const P = { ...DEFAULT_REGIME_PARAMETERS, ...parameters };
  if (!Number.isInteger(P.emaSlow) || P.emaSlow < 1 || !Number.isInteger(P.confirmBars) || P.confirmBars < 1) {
    throw new RangeError("emaSlow and confirmBars must be positive integers");
  }
  if (index < Math.max(P.emaSlow, 30) || p.e200[index] == null || p.adx[index] == null) return null;

  const c = p.c[index];
  const v20 = average(p.v.slice(Math.max(0, index - 20), index));
  const hi5 = Math.max(...p.c.slice(index - 5, index));
  const maxV5 = Math.max(...p.v.slice(index - 4, index + 1));
  const drop = c / hi5 - 1;
  const structure = structureAt(p, index);
  const bbP = pctRank(p.bbw, index, 180);
  const atP = pctRank(p.atrp, index, 180);
  const facts = {
    c, e20: p.e20[index], e50: p.e50[index], e200: p.e200[index],
    adx: p.adx[index], rsi: p.rsi[index], atrp: p.atrp[index],
    bbP, atP, st: structure, drop, volX: maxV5 / v20
  };
  const f1 = value => value.toFixed(1);

  if (drop <= -P.capDrop / 100 && p.rsi[index] < P.rsiCap && maxV5 >= P.capVolMult * v20) {
    return { reg: "Kapitulasi", why: `Down ${f1(drop * 100)}% in 5 days, RSI ${f1(p.rsi[index])}, volume ${f1(maxV5 / v20)}× the 20-day average.`, facts };
  }
  if (c < p.e200[index] && p.e50[index] < p.e200[index] && structure === "LH-LL") {
    return { reg: "Downtrend", why: "Close below the 200 EMA, 50 EMA below the 200 EMA, LH–LL structure.", facts };
  }
  if (bbP != null && atP != null && bbP <= P.compPct && atP <= P.compPct) {
    return { reg: "Kompresi", why: `Bollinger Band width at the ${bbP.toFixed(0)}th and ATR% at the ${atP.toFixed(0)}th percentile of 180 days.`, facts };
  }
  if (c > p.e200[index] && p.e50[index] > p.e200[index] && p.adx[index] > P.adxTrend && structure === "HH-HL") {
    return { reg: "Uptrend", why: `Close above the 200 EMA, 50 EMA above the 200 EMA, ADX ${f1(p.adx[index])}, HH–HL structure.`, facts };
  }
  if (p.adx[index] < P.adxRange && Math.abs(c / p.e50[index] - 1) <= 0.05) {
    return { reg: "Sideways", why: `ADX ${f1(p.adx[index])} and price within ${f1(Math.abs(c / p.e50[index] - 1) * 100)}% of the 50 EMA.`, facts };
  }
  if (c < p.e200[index]) {
    return { reg: "Downtrend", why: "No rule fully met; price is below the 200 EMA, so it is treated as a (weak) downtrend.", facts, weak: true };
  }
  return { reg: "Sideways", why: "No rule fully met; price is above the 200 EMA without a strong trend, so it is treated as a range.", facts, weak: true };
}

/**
 * Effective regime per bar with N-bar confirmation.
 * This intentionally mirrors legacy behavior: the first valid regime seeds
 * the state immediately; subsequent changes require confirmBars consecutive
 * raw labels. A pending transition retains the prior effective regime.
 */
export function buildRegimeTimeline(prepared, parameters = {}) {
  validatePreparedSeries(prepared);
  const P = { ...DEFAULT_REGIME_PARAMETERS, ...parameters };
  if (!Number.isInteger(P.confirmBars) || P.confirmBars < 1) throw new RangeError("confirmBars must be a positive integer");
  const raw = [], effective = [];
  let current = null;
  for (let i = 0; i < prepared.n; i++) {
    const result = classifyRegimeAt(prepared, i, P);
    raw.push(result);
    if (!result) {
      effective.push(null);
      continue;
    }
    let confirmed = true;
    for (let k = 1; k < P.confirmBars; k++) {
      if (!raw[i - k] || raw[i - k].reg !== result.reg) confirmed = false;
    }
    if (confirmed || !current) current = result.reg;
    effective.push(current);
  }
  return { raw, eff: effective };
}
