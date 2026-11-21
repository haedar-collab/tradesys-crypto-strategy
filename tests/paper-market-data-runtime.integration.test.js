import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBinanceSpotBookTickerSupervisor } from "../src/data/binance-spot-book-ticker-supervisor.js";
import { createPersistentPaperSession } from "../src/paper/persistent-paper-session.js";
import { createPaperMarketDataBridge } from "../src/paper/paper-market-data-bridge.js";
import { createPaperMarketDataRuntime } from "../src/paper/paper-market-data-runtime.js";

class FakeTimers {
  tasks = new Map();
  nextId = 1;
  setTimeout = (fn, delay) => {
    const id = this.nextId++;
    this.tasks.set(id, { fn, delay });
    return id;
  };
  clearTimeout = id => this.tasks.delete(id);
  async runDelay(delay) {
    const entry = [...this.tasks.entries()].find(([, task]) => task.delay === delay);
    assert.ok(entry, `expected a scheduled timer at ${delay}ms`);
    const [id, task] = entry;
    this.tasks.delete(id);
    await task.fn();
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
    const handlers = this.handlers.get(name) ?? [];
    handlers.push(fn);
    this.handlers.set(name, handlers);
  }
  emit(name, value = {}) {
    for (const handler of this.handlers.get(name) ?? []) handler(value);
  }
  open() { this.emit("open"); }
  message(value) { this.emit("message", { data: JSON.stringify(value) }); }
  close(code = 1000, reason = "") {
    this.closed = true;
    this.emit("close", { code, reason });
  }
}

const NOW = 1_800_000_000_000;
const payload = (updateId = 101, bid = "100.00", ask = "100.10") => ({
  u: updateId, s: "BTCUSDT", b: bid, B: "2.0", a: ask, A: "3.0"
});

test("real feed adapter -> supervisor -> runtime -> bridge -> persistent ledger; disconnect fails closed", async () => {
  MockSocket.instances = [];
  const timers = new FakeTimers();
  const dir = await mkdtemp(join(tmpdir(), "tradesys-e2e-market-runtime-"));
  const filePath = join(dir, "events.jsonl");
  let session;
  let runtime;
  try {
    session = await createPersistentPaperSession({
      filePath,
      now: () => NOW,
      requireMarketDataProvenance: true,
      maxQuoteAgeMs: 5_000
    });

    const supervisor = createBinanceSpotBookTickerSupervisor({
      symbols: ["BTCUSDT"],
      feedOptions: {
        WebSocketCtor: MockSocket,
        now: () => NOW,
        setTimeoutFn: timers.setTimeout,
        clearTimeoutFn: timers.clearTimeout,
        reconnectBaseMs: 100,
        reconnectMaxMs: 800,
        staleAfterMs: 5_000
      }
    });
    const bridge = createPaperMarketDataBridge({
      supervisor, session, now: () => NOW, maxQuoteAgeMs: 5_000
    });
    const markErrors = [];
    runtime = createPaperMarketDataRuntime({
      supervisor, bridge, markIntervalMs: 250,
      setTimeoutFn: timers.setTimeout,
      clearTimeoutFn: timers.clearTimeout,
      onError: error => markErrors.push(error)
    });

    runtime.start();
    const socket = MockSocket.instances[0];
    assert.match(socket.url, /btc usdt/i.test(socket.url) ? /btc usdt/i : /btcusdt@bookTicker/);
    socket.open();
    socket.message(payload());

    const quote = supervisor.getQuote("BTCUSDT");
    assert.equal(quote.source, "BINANCE_SPOT_WS_BOOK_TICKER");
    assert.equal(quote.eventTimeBasis, "LOCAL_RECEIVE_TIME");
    await session.submitMarketOrder({
      clientOrderId: "e2e_runtime_buy_001",
      symbol: "BTCUSDT",
      side: "BUY",
      quantity: 1,
      quote,
      strategyAcceptance: { decision: "ACCEPT", eligibleForPaperTrading: true }
    });

    await timers.runDelay(250);
    let snapshot = await session.snapshot();
    let marks = snapshot.ledger.events.filter(event => event.type === "POSITION_MARKED");
    assert.equal(marks.length, 1);
    assert.equal(marks[0].payload.marketDataProvenance[0].source, "BINANCE_SPOT_WS_BOOK_TICKER");
    assert.equal(runtime.getStatus().state, "RUNNING");

    socket.close(1006, "simulated network disconnect");
    assert.equal(supervisor.checkHealth().BTCUSDT.healthy, false);
    await timers.runDelay(250);
    assert.equal(markErrors.length, 1);
    assert.equal(markErrors[0].code, "PAPER_MARKET_DATA_UNAVAILABLE");

    snapshot = await session.snapshot();
    marks = snapshot.ledger.events.filter(event => event.type === "POSITION_MARKED");
    assert.equal(marks.length, 1, "disconnect must not append a partial or synthetic mark");

    // Reconnect after bounded backoff; only a fresh quote from the new socket
    // restores health and permits the next durable portfolio mark.
    await timers.runDelay(100);
    const recoveredSocket = MockSocket.instances[1];
    assert.ok(recoveredSocket, "feed should create a replacement socket after backoff");
    recoveredSocket.open();
    recoveredSocket.message(payload(102, "101.00", "101.10"));
    assert.equal(supervisor.checkHealth().BTCUSDT.healthy, true);

    await timers.runDelay(250);
    snapshot = await session.snapshot();
    marks = snapshot.ledger.events.filter(event => event.type === "POSITION_MARKED");
    assert.equal(marks.length, 2, "fresh quote after reconnect should resume durable marking");
    assert.equal(marks[1].payload.marketDataProvenance[0].source, "BINANCE_SPOT_WS_BOOK_TICKER");

    await runtime.stop();
    assert.equal(runtime.getStatus().state, "STOPPED");
    assert.equal(timers.tasks.size, 0, "runtime and feed timers must all be cleared");
    assert.ok(MockSocket.instances.every(item => item.closed), "all WebSocket connections must be closed");
    await session.close();
    session = null;
  } finally {
    if (runtime) await runtime.stop().catch(() => {});
    if (session) await session.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});
