import test from "node:test";
import assert from "node:assert/strict";
import { ema, sma, wilder, rsi, trueRange, atr, adx, bbands, obv, pivotsAll, pctRank } from "../src/indicators/index.js";

const avg = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
function legacyEma(a, p) { const k = 2 / (p + 1), out = []; let prev = null; for (let i = 0; i < a.length; i++) { if (i < p - 1) { out.push(null); continue; } if (prev === null) { let s = 0; for (let j = i - p + 1; j <= i; j++) s += a[j]; prev = s / p; } else prev = a[i] * k + prev * (1 - k); out.push(prev); } return out; }
function legacySma(a, p) { const out = []; let sum = 0; for (let i = 0; i < a.length; i++) { sum += a[i]; if (i >= p) sum -= a[i - p]; out.push(i < p - 1 ? null : sum / p); } return out; }
function legacyWilder(a, p) { const out = []; let prev = null, buffer = []; for (let i = 0; i < a.length; i++) { const v = a[i]; if (v == null) { out.push(null); continue; } if (prev === null) { buffer.push(v); if (buffer.length < p) { out.push(null); continue; } prev = avg(buffer); } else prev = (prev * (p - 1) + v) / p; out.push(prev); } return out; }
function legacyRsi(c, p = 14) { const gains = [null], losses = [null]; for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1]; gains.push(Math.max(d, 0)); losses.push(Math.max(-d, 0)); } const ag = legacyWilder(gains, p), al = legacyWilder(losses, p); return c.map((_, i) => ag[i] == null ? null : al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i])); }
function legacyTr(h, l, c) { return h.map((_, i) => i === 0 ? h[0] - l[0] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))); }
function legacyAtr(h, l, c, p = 14) { return legacyWilder(legacyTr(h, l, c), p); }
function legacyAdx(h, l, c, p = 14) { const pdm = [null], mdm = [null]; for (let i = 1; i < h.length; i++) { const up = h[i] - h[i - 1], down = l[i - 1] - l[i]; pdm.push(up > down && up > 0 ? up : 0); mdm.push(down > up && down > 0 ? down : 0); } const tr = legacyTr(h, l, c); tr[0] = null; const str = legacyWilder(tr, p), sp = legacyWilder(pdm, p), sm = legacyWilder(mdm, p); const dx = c.map((_, i) => { if (!str[i]) return null; const pdi = 100 * sp[i] / str[i], mdi = 100 * sm[i] / str[i]; return pdi + mdi === 0 ? 0 : 100 * Math.abs(pdi - mdi) / (pdi + mdi); }); return legacyWilder(dx, p); }
function legacyBands(c, p = 20, m = 2) { const mid = legacySma(c, p); return c.map((_, i) => { if (mid[i] == null) return null; let sum = 0; for (let j = i - p + 1; j <= i; j++) sum += (c[j] - mid[i]) ** 2; const sd = Math.sqrt(sum / p); return { mid: mid[i], up: mid[i] + m * sd, lo: mid[i] - m * sd, width: (2 * m * sd) / mid[i] }; }); }
function legacyObv(c, v) { const out = [0]; for (let i = 1; i < c.length; i++) out.push(out[i - 1] + (c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0)); return out; }
function legacyPivots(h, l, k = 3) { const hi = [], lo = []; for (let i = k; i < h.length - k; i++) { let isHigh = true, isLow = true; for (let j = i - k; j <= i + k; j++) { if (j === i) continue; if (h[j] >= h[i]) isHigh = false; if (l[j] <= l[i]) isLow = false; } if (isHigh) hi.push(i); if (isLow) lo.push(i); } return { hi, lo }; }

function compare(actual, expected, path = "value") {
  if (expected == null || typeof expected === "string") { assert.equal(actual, expected, path); return; }
  if (typeof expected === "number") { assert.ok(Math.abs(actual - expected) <= 1e-10 * Math.max(1, Math.abs(expected)), `${path}: ${actual} != ${expected}`); return; }
  if (Array.isArray(expected)) { assert.equal(actual.length, expected.length, path + " length"); expected.forEach((v, i) => compare(actual[i], v, `${path}[${i}]`)); return; }
  for (const key of Object.keys(expected)) compare(actual[key], expected[key], path + "." + key);
}

test("extracted indicators match frozen Tradesys calculations on a deterministic OHLCV fixture", () => {
  const c = Array.from({ length: 320 }, (_, i) => 100 + 0.08 * i + 3 * Math.sin(i / 5) + 0.7 * Math.cos(i / 2.7));
  const h = c.map((v, i) => v + 1.2 + 0.2 * Math.sin(i));
  const l = c.map((v, i) => v - 1.1 - 0.2 * Math.cos(i));
  const v = c.map((_, i) => 1000 + 100 * Math.sin(i / 3) + i);
  compare(ema(c, 20), legacyEma(c, 20), "EMA");
  compare(sma(c, 20), legacySma(c, 20), "SMA");
  compare(wilder(c, 14), legacyWilder(c, 14), "Wilder");
  compare(rsi(c), legacyRsi(c), "RSI");
  compare(trueRange(h, l, c), legacyTr(h, l, c), "TR");
  compare(atr(h, l, c), legacyAtr(h, l, c), "ATR");
  compare(adx(h, l, c), legacyAdx(h, l, c), "ADX");
  compare(bbands(c), legacyBands(c), "BBands");
  compare(obv(c, v), legacyObv(c, v), "OBV");
  compare(pivotsAll(h, l), legacyPivots(h, l), "Pivots");
  for (let i = 179; i < c.length; i++) assert.equal(pctRank(c, i, 180), (() => { const slice = c.slice(Math.max(0, i - 179), i + 1); return 100 * slice.filter(x => x <= c[i]).length / slice.length; })());
});
