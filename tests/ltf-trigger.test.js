import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLtfTrigger } from "../src/structure/ltf-trigger.js";

function fixture() {
  const n = 60;
  const c = Array(n).fill(98), o = Array(n).fill(98), h = Array(n).fill(101), l = Array(n).fill(100);
  l[50] = 98;
  return {
    n, t: Array.from({ length: n }, (_, i) => i * 3_600_000),
    ct: Array.from({ length: n }, (_, i) => (i + 1) * 3_600_000 - 1),
    o, h, l, c, atr: Array(n).fill(2), piv: { hi: [], lo: [] }
  };
}

const zone = { lo: 95, hi: 99 };

test("returns touch without a bullish 1H confirmation", () => {
  const p = fixture();
  const result = evaluateLtfTrigger(p, zone, 4);
  assert.equal(result.state, "touch");
  assert.equal(result.touchedAt, p.t[50]);
  assert.equal(result.trigger, null);
  assert.equal(result.stop1h, 97.5);
});

test("confirms bullish 1H BOS after the zone is touched", () => {
  const p = fixture();
  p.piv.hi = [45];
  p.h[45] = 100;
  p.c[55] = 101;
  p.c[59] = 101;
  const result = evaluateLtfTrigger(p, zone, 4);
  assert.equal(result.state, "confirmed");
  assert.equal(result.trigger, "1H BOS");
  assert.equal(result.at, p.t[55]);
  assert.equal(result.level, 100);
});

test("confirms 1H swing-low sweep and reclaim", () => {
  const p = fixture();
  p.piv.lo = [50];
  p.l[50] = 97.5;
  p.l[51] = 97;
  p.o[51] = 97.8;
  p.c[51] = 98;
  p.c[59] = 98;
  const result = evaluateLtfTrigger(p, zone, 4);
  assert.equal(result.state, "confirmed");
  assert.equal(result.trigger, "1H sweep + reclaim");
  assert.equal(result.level, 97.5);
  assert.equal(result.at, p.t[51]);
});

test("marks the 1H trigger broken after close below zone invalidation", () => {
  const p = fixture();
  p.c[59] = 94;
  const result = evaluateLtfTrigger(p, zone, 4);
  assert.equal(result.state, "broken");
});

test("returns null when 1H history is insufficient", () => {
  const p = fixture();
  p.n = 20; p.t = p.t.slice(0, 20); p.ct = p.ct.slice(0, 20);
  p.o = p.o.slice(0, 20); p.h = p.h.slice(0, 20); p.l = p.l.slice(0, 20);
  p.c = p.c.slice(0, 20); p.atr = p.atr.slice(0, 20);
  assert.equal(evaluateLtfTrigger(p, zone, 4), null);
});
