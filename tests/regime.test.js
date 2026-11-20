import test from "node:test";
import assert from "node:assert/strict";
import { classifyRegimeAt, buildRegimeTimeline, structureAt } from "../src/regime/index.js";

function prepared(length = 205) {
  const c = Array(length).fill(100), h = Array(length).fill(102), l = Array(length).fill(98);
  return {
    n: length, t: Array.from({ length }, (_, i) => i),
    c, h, l, o: c.slice(), v: Array(length).fill(1000),
    e20: Array(length).fill(100), e50: Array(length).fill(100), e200: Array(length).fill(99),
    adx: Array(length).fill(10), rsi: Array(length).fill(50),
    bbw: Array.from({ length }, (_, i) => i + 1), atrp: Array.from({ length }, (_, i) => i + 1),
    piv: { hi: [190, 195], lo: [191, 196] }
  };
}

test("insufficient history returns no regime", () => {
  const p = prepared();
  assert.equal(classifyRegimeAt(p, 199, { emaSlow: 200 }), null);
});

test("classifies weak sideways regime with legacy fallback", () => {
  const p = prepared();
  p.c[200] = 106;
  const result = classifyRegimeAt(p, 200, { emaSlow: 200 });
  assert.equal(result.reg, "Sideways");
  assert.equal(result.weak, true);
  assert.equal(typeof result.why, "string");
});

test("classifies downtrend only when price, EMA alignment, and LH-LL agree", () => {
  const p = prepared();
  p.c[200] = 90;
  p.e50[200] = 95;
  p.e200[200] = 100;
  p.h[190] = 110; p.h[195] = 105;
  p.l[191] = 95; p.l[196] = 90;
  assert.equal(structureAt(p, 200), "LH-LL");
  assert.equal(classifyRegimeAt(p, 200, { emaSlow: 200 }).reg, "Downtrend");
});

test("pending regime transition retains previous effective regime until confirmed", () => {
  const p = prepared();
  for (let i = 201; i < p.n; i++) {
    p.c[i] = 90; p.e50[i] = 95; p.e200[i] = 100;
  }
  p.h[190] = 110; p.h[195] = 105;
  p.l[191] = 95; p.l[196] = 90;
  const timeline = buildRegimeTimeline(p, { emaSlow: 200, confirmBars: 2 });
  assert.equal(timeline.raw[200].reg, "Sideways");
  assert.equal(timeline.raw[201].reg, "Downtrend");
  assert.equal(timeline.eff[201], "Sideways");
  assert.equal(timeline.raw[202].reg, "Downtrend");
  assert.equal(timeline.eff[202], "Downtrend");
});

test("classifies capitulation ahead of generic downtrend when all capitulation rules pass", () => {
  const p = prepared();
  for (let i = 195; i <= 200; i++) p.c[i] = 100 - (i - 195) * 5;
  p.rsi[200] = 10;
  p.v[196] = 5000; p.v[197] = 5000; p.v[198] = 5000; p.v[199] = 5000; p.v[200] = 5000;
  const result = classifyRegimeAt(p, 200, { emaSlow: 200, capDrop: 20, rsiCap: 25, capVolMult: 2.5 });
  assert.equal(result.reg, "Kapitulasi");
});
