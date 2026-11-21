import test from "node:test";
import assert from "node:assert/strict";
import { createBinanceSpotBookTickerFeed } from "../src/data/binance-spot-book-ticker-feed.js";

class FakeTimers {
  tasks = new Map();
  nextId = 1;
  setTimeout = (fn, delay) => {
    const id = this.nextId++;
    this.tasks.set(id, { fn, delay });
    return id;
  };
  clearTimeout = id => this.tasks.delete(id);
  runNext() {
    const entry = this.tasks.entries().next().value;
    assert.ok(entry, "expected a scheduled timer");
    const [id, task] = entry;
    this.tasks.delete(id);
    task.fn();
    return task.delay;
  }
}

class MockSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.handlers = new Map();
    this.closed = false;
    MockSocket.instances.push(this);
  }
  addEventListener(name, fn) {
    const list = this.handlers.get(name) ?? [];
    list.push(fn);
    this.handlers.set(name, list);
  }
  emit(name, value = {}) {
    for (const fn of this.handlers.get(name) ?? []) fn(value);
  }
  open() { this.emit("open"); }
  message(value) { this.emit("message", { data: JSON.stringify(value) }); }
  close(code = 1000, reason = "") {
    this.closed = true;
    this.emit("close", { code, reason });
  }
}

function setup(overrides = {}) {
  MockSocket.instances = [];
  const timers = new FakeTimers();
  let now = 1_800_000_000_000;
  const quotes = [], states = [], errors = [];
  const feed = createBinanceSpotBookTickerFeed({
    symbol: "BTCUSDT",
    WebSocketCtor: MockSocket,
    now: () => now,
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
    reconnectBaseMs: 100,
    reconnectMaxMs: 800,
    staleAfterMs: 500,
    onQuote: quote => quotes.push(quote),
    onState: event => states.push(event),
    onError: error => errors.push(error),
    ...overrides
  });
  return { feed, timers, quotes, states, errors, setNow: value => { now = value; } };
}

const payload = (overrides = {}) => ({
  u: 123, s: "BTCUSDT", b: "100.00", B: "2.0", a: "100.10", A: "3.0", ...overrides
});

test("connects to the exact Binance Spot bookTicker stream and parses a quote", () => {
  const { feed, quotes, states } = setup();
  feed.start();
  const socket = MockSocket.instances[0];
  assert.equal(socket.url, "wss://stream.binance.com:9443/ws/btcusdt@bookTicker");
  assert.equal(feed.getState(), "CONNECTING");
  socket.open();
  socket.message(payload());
  assert.equal(feed.getState(), "CONNECTED");
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].source, "BINANCE_SPOT_WS_BOOK_TICKER");
  assert.equal(quotes[0].eventTime, quotes[0].receivedAt);
  assert.equal(quotes[0].eventTimeBasis, "LOCAL_RECEIVE_TIME");
  assert.equal(quotes[0].bid, 100);
  assert.equal(quotes[0].ask, 100.1);
  assert.equal(feed.checkHealth().healthy, true);
  assert.ok(states.some(item => item.state === "CONNECTED"));
  feed.stop();
});

test("uses exchange event time when present and rejects invalid payloads without emitting quotes", () => {
  const { feed, quotes, errors } = setup();
  feed.start();
  const socket = MockSocket.instances[0];
  socket.open();
  socket.message(payload({ E: 1_799_999_999_900 }));
  socket.message(payload({ s: "ETHUSDT" }));
  socket.message("{malformed");
  socket.message(payload({ b: "0", a: "0" }));
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].eventTime, 1_799_999_999_900);
  assert.equal(quotes[0].eventTimeBasis, "EXCHANGE_EVENT_TIME");
  assert.equal(errors.length, 3);
  feed.stop();
});

test("reconnects after disconnect using bounded backoff", () => {
  const { feed, timers, states } = setup();
  feed.start();
  const first = MockSocket.instances[0];
  first.open();
  first.close(1006, "network loss");
  assert.equal(feed.getState(), "RECONNECT_WAIT");
  assert.equal(timers.runNext(), 100);
  assert.equal(MockSocket.instances.length, 2);
  assert.ok(states.some(item => item.state === "DISCONNECTED"));
  feed.stop();
});

test("stale watchdog marks feed stale and reconnects", () => {
  const { feed, timers, states } = setup();
  feed.start();
  const socket = MockSocket.instances[0];
  socket.open();
  timers.runNext();
  assert.equal(socket.closed, true);
  assert.ok(states.some(item => item.state === "STALE"));
  assert.equal(feed.getState(), "RECONNECT_WAIT");
  feed.stop();
});

test("stop cancels reconnect and stale timers and prevents reconnect", () => {
  const { feed, timers } = setup();
  feed.start();
  const socket = MockSocket.instances[0];
  socket.close(1006, "lost");
  feed.stop();
  assert.equal(timers.tasks.size, 0);
  assert.equal(feed.getState(), "STOPPED");
  assert.equal(MockSocket.instances.length, 1);
  timers.tasks.size && timers.runNext();
  assert.equal(MockSocket.instances.length, 1);
});

test("ignores events from superseded sockets", () => {
  const { feed, timers, quotes } = setup();
  feed.start();
  const oldSocket = MockSocket.instances[0];
  oldSocket.close(1006, "lost");
  timers.runNext();
  const current = MockSocket.instances[1];
  oldSocket.message(payload({ u: 999 }));
  current.open();
  current.message(payload({ u: 124 }));
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].updateId, 124);
  feed.stop();
});

test("reports unhealthy state before first quote and after quote expiry", () => {
  const { feed, timers, setNow } = setup();
  feed.start();
  MockSocket.instances[0].open();
  assert.equal(feed.checkHealth().reason, "NO_RECENT_QUOTE");
  MockSocket.instances[0].message(payload());
  setNow(1_800_000_000_600);
  assert.equal(feed.checkHealth().healthy, false);
  assert.equal(feed.checkHealth().reason, "NO_RECENT_QUOTE");
  feed.stop();
});

test("validates required constructor options", () => {
  assert.throws(() => createBinanceSpotBookTickerFeed({ symbol: "btc", WebSocketCtor: MockSocket }), /symbol/);
  assert.throws(() => createBinanceSpotBookTickerFeed({ symbol: "BTCUSDT", WebSocketCtor: null }), /WebSocketCtor/);
});
