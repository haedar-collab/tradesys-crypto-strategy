import test from "node:test";
import assert from "node:assert/strict";
import { runHistoricalMtfReplay } from "../src/backtest/historical-mtf-replay.js";

const emptyInput = { weekly: [], daily: [], h4: [], h1: [] };

test("historical MTF replay rejects missing or malformed timeframe arrays", () => {
  assert.throws(
    () => runHistoricalMtfReplay({ ...emptyInput, h1: null }, [1000]),
    /h1 candles must be an array/
  );
});

test("historical MTF replay rejects empty and non-monotonic evaluation timelines", () => {
  assert.throws(() => runHistoricalMtfReplay(emptyInput, []), /non-empty array/);
  assert.throws(() => runHistoricalMtfReplay(emptyInput, [2000, 1000]), /strictly increasing/);
});

test("historical MTF replay fails closed when historical context is unavailable", () => {
  const result = runHistoricalMtfReplay(emptyInput, [10_000, 20_000]);
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.mode, "historical-research-only");
  assert.equal(result.evaluationCount, 2);
  assert.equal(result.candidateCount, 0);
  assert.equal(result.decisions.every(item => item.status === "WAIT" && !item.candidate), true);
  assert.equal(result.assumptions.execution.includes("no order execution"), true);
});
