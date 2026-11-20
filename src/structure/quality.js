/**
 * Supply/demand quality model extracted from the frozen Tradesys implementation.
 * Measures departure strength, base pattern and post-creation retests.
 */
function validate(p) {
  if (!p || !Number.isInteger(p.n) || p.n < 1 ||
      !["o", "h", "l", "c"].every(k => Array.isArray(p[k]) && p[k].length === p.n)) {
    throw new TypeError("prepared series must contain aligned o/h/l/c arrays and n");
  }
}

export function zoneVisits(p, lo, hi, from, side, asOf = p?.n) {
  validate(p);
  if (![lo, hi].every(Number.isFinite) || lo >= hi || !Number.isInteger(from) ||
      from < 0 || from > p.n || !Number.isInteger(asOf) || asOf < from || asOf > p.n || !["demand", "supply"].includes(side)) {
    throw new RangeError("invalid zone visit arguments");
  }
  let visits = 0, inside = false, ongoing = false;
  for (let q = from; q < asOf; q++) {
    const touch = side === "demand" ? p.l[q] <= hi : p.h[q] >= lo;
    if (touch && !inside) visits++;
    inside = touch;
    if (q === asOf - 1) ongoing = touch;
  }
  return { prior: Math.max(0, visits - (ongoing ? 1 : 0)), ongoing };
}

export function zoneOrigin(p, idx, atr, side, upto, zlo, zhi, asOf = p?.n) {
  validate(p);
  if (!Number.isInteger(idx) || idx < 0 || idx >= p.n || !Number.isFinite(atr) || atr <= 0 ||
      !["demand", "supply"].includes(side)) throw new RangeError("invalid zone origin arguments");
  let b0 = idx;
  while (b0 > Math.max(0, idx - 3) && Math.abs(p.c[b0 - 1] - p.o[b0 - 1]) <= 0.6 * (p.atr?.[b0 - 1] || atr)) b0--;
  const baseN = idx - b0 + 1, i0 = Math.max(0, b0 - 3);
  const legIn = p.c[Math.max(0, b0 - 1)] - p.c[i0];
  if (!Number.isInteger(asOf) || asOf <= idx || asOf > p.n) throw new RangeError("asOf must be after zone origin and within available history");
  const j1 = Math.min(asOf - 1, Math.max(idx + 5, Math.min((upto || 0) - 1, idx + 12)));
  const zHi = zhi != null ? zhi : Math.max(p.o[idx], p.c[idx]);
  const zLo = zlo != null ? zlo : Math.min(p.o[idx], p.c[idx], p.l[idx]);
  const depart = side === "demand"
    ? (Math.max(...p.h.slice(idx, j1 + 1)) - zHi) / atr
    : (zLo - Math.min(...p.l.slice(idx, j1 + 1))) / atr;
  const pattern = side === "demand" ? (legIn < 0 ? "DBR" : "RBR") : (legIn > 0 ? "RBD" : "DBD");
  return { pattern, baseN, departAtr: Number.isFinite(depart) ? Math.max(0, depart) : 0 };
}

export function zoneQuality(p, zone, atr, side, from, asOf = p?.n) {
  validate(p);
  if (!zone || zone.idx == null) return null;
  if (![zone.lo, zone.hi].every(Number.isFinite) || zone.lo >= zone.hi ||
      !Number.isInteger(zone.idx) || zone.idx < 0 || zone.idx >= p.n ||
      !Number.isFinite(atr) || atr <= 0 || !["demand", "supply"].includes(side)) {
    throw new RangeError("invalid zone quality arguments");
  }
  const origin = zoneOrigin(p, zone.idx, atr, side, from, zone.lo, zone.hi);
  const visits = zoneVisits(p, zone.lo, zone.hi, Math.max(zone.idx + 1, from || 0), side);
  const strength = origin.departAtr >= 3 ? "Strong" : origin.departAtr >= 1.5 ? "Moderate" : "Weak";
  const quality = visits.prior >= 2 || strength === "Weak" ? "Weak"
    : visits.prior === 1 || strength === "Moderate" ? "Moderate" : "Strong";
  return {
    ...origin, strength, prior: visits.prior, inNow: visits.ongoing,
    fresh: visits.prior === 0, quality,
    text: `${quality} · ${origin.pattern} · base ${origin.baseN} candle${origin.baseN > 1 ? "s" : ""} · departure ${origin.departAtr.toFixed(1)} ATR · ${visits.prior === 0 ? (visits.ongoing ? "fresh, first test now" : "fresh") : `tested ${visits.prior}×`}`
  };
}
