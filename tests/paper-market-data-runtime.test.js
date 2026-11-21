import test from "node:test";
import assert from "node:assert/strict";
import { createPaperMarketDataRuntime } from "../src/paper/paper-market-data-runtime.js";

class FakeTimers {
  tasks = new Map();
  id = 0;
  setTimeout = (fn, delay) => {
    const id = ++this.id;
    this.tasks.set(id, { fn, delay });
    return id;
  };
  clearTimeout = id => this.tasks.delete(id);
  async runNext() {
    const entry = this.tasks.entries().next().value;
    assert.ok(entry, "expected scheduled cadence timer");
    const [id, task] = entry;
    this.tasks.delete(id);
    return task.fn();
  }
}

function setup(markOpenPositions = async () => ({ status: "NO_OPEN_POSITIONS", marks: [] })) {
  const timers = new FakeTimers();
  const calls = { start: 0, stop: 0, mark: 0, results: [], errors: [] };
  const supervisor = {
    start() { calls.start += 1; },
    stop() { calls.stop += 1; }
  };
  const bridge = {
    async markOpenPositions() {
      calls.mark += 1;
      return markOpenPositions(calls.mark);
    }
  };
  const runtime = createPaperMarketDataRuntime({
    supervisor, bridge, markIntervalMs: 250,
    setTimeoutFn: timers.setTimeout, clearTimeoutFn: timers.clearTimeout,
    onMark: result => calls.results.push(result),
    onError: error => calls.errors.push(error)
  });
  return { runtime, timers, calls };
}

test("starts and stops supervisor with a single recursive mark cadence", async () => {
  const { runtime, timers, calls } = setup();
  runtime.start();
  runtime.start();
  assert.equal(calls.start, 1);
  assert.deepEqual(runtime.getStatus(), { state: "RUNNING", markInFlight: false, timerScheduled: true });
  await timers.runNext();
  assert.equal(calls.mark, 1);
  assert.equal(calls.results.length, 1);
  assert.equal(timers.tasks.size, 1);
  await runtime.stop();
  assert.equal(calls.stop, 1);
  assert.equal(timers.tasks.size, 0);
  assert.equal(runtime.getStatus().state, "STOPPED");
  await assert.rejects(runtime.markNow(), /not started/);
});

test("coalesces concurrent manual marks into one bridge operation", async () => {
  let resolveMark;
  const { runtime, calls } = setup(() => new Promise(resolve => { resolveMark = resolve; }));
  runtime.start();
  const first = runtime.markNow();
  const second = runtime.markNow();
  assert.equal(calls.mark, 0);
  await Promise.resolve();
  assert.equal(calls.mark, 1);
  resolveMark({ status: "MARKED", symbols: ["BTCUSDT"] });
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b);
  assert.equal(calls.results.length, 1);
  await runtime.stop();
});

test("periodic mark errors are reported and cadence continues", async () => {
  const { runtime, timers, calls } = setup(async count => {
    if (count === 1) throw new Error("stale feed");
    return { status: "MARKED", symbols: ["BTCUSDT"] };
  });
  runtime.start();
  await timers.runNext();
  assert.equal(calls.errors.length, 1);
  assert.match(calls.errors[0].message, /stale feed/);
  assert.equal(timers.tasks.size, 1);
  await timers.runNext();
  assert.equal(calls.results.length, 1);
  await runtime.stop();
});

test("stop waits for an in-flight mark and prevents another cadence", async () => {
  let resolveMark;
  const { runtime, timers, calls } = setup(() => new Promise(resolve => { resolveMark = resolve; }));
  runtime.start();
  const mark = runtime.markNow();
  await Promise.resolve();
  const stopping = runtime.stop();
  assert.equal(calls.stop, 1);
  resolveMark({ status: "MARKED", symbols: ["BTCUSDT"] });
  await Promise.all([mark, stopping]);
  assert.equal(timers.tasks.size, 0);
  assert.equal(runtime.getStatus().state, "STOPPED");
});

test("validates runtime dependencies and cadence", () => {
  assert.throws(() => createPaperMarketDataRuntime({}), /supervisor/);
  assert.throws(() => createPaperMarketDataRuntime({
    supervisor: { start() {}, stop() {} },
    bridge: { markOpenPositions() {} },
    markIntervalMs: 0
  }), /markIntervalMs/);
});
