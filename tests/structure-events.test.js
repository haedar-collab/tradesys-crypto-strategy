import test from "node:test";
import assert from "node:assert/strict";
import { structureEvents } from "../src/structure/events.js";

function fixture() {
  const n = 8;
  return {
    n,
    c: [9, 9, 9, 11, 10, 10, 2, 2],
    h: [10, 10, 9, 11, 11, 10, 3, 3],
    l: [8, 7, 4, 7, 8, 3, 2, 2],
    piv: { hi: [1, 4], lo: [2, 5] }
  };
}

test("confirms pivots only after configured right-side bars", () => {
  const p = fixture();
  const result = structureEvents(p, 2);
  assert.deepEqual(result.events, [
    { type: "BOS", dir: 1, level: 10, i: 3, from: 1 },
    { type: "CHoCH", dir: -1, level: 3, i: 6, from: 5 }
  ]);
  assert.equal(result.trend, -1);
});

test("emits BOS when structure breaks in the initial direction", () => {
  const p = fixture();
  p.c[6] = 4;
  const result = structureEvents(p, 2);
  assert.deepEqual(result.events.map(event => event.type), ["BOS"]);
  assert.equal(result.trend, 1);
});

test("rejects invalid prepared series and confirmation length", () => {
  assert.throws(() => structureEvents({ n: 2, c: [1], h: [1, 1], l: [1, 1], piv: { hi: [], lo: [] } }), TypeError);
  assert.throws(() => structureEvents(fixture(), 0), RangeError);
});
