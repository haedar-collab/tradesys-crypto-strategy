import { createHash } from "node:crypto";
import { createPaperBroker } from "./paper-broker.js";
import { createPersistentPaperLedger } from "./persistent-paper-ledger.js";

const clone = (value) => structuredClone(value);
const canonical = (value) => JSON.stringify(value);
const eventId = (clientOrderId, suffix) =>
  "paper_" + createHash("sha256").update(clientOrderId).digest("hex").slice(0, 32) + "_" + suffix;

/**
 * Event-sourced paper session. The append-only ledger is the durable source of
 * truth; the in-memory broker is rebuilt from recorded order inputs on startup.
 * This adapter is paper-only and never connects to an exchange.
 */
export async function createPersistentPaperSession({
  filePath,
  initialCash = 10_000,
  feeBps = 10,
  slippageBps = 5,
  maxQuoteAgeMs = 5_000,
  now = () => Date.now()
} = {}) {
  if (typeof now !== "function") throw new TypeError("now must be a function");
  let clock = now();
  if (!Number.isSafeInteger(clock) || clock < 0) throw new TypeError("now must return UTC epoch milliseconds");
  const ledger = await createPersistentPaperLedger({ filePath });
  const broker = createPaperBroker({
    initialCash, feeBps, slippageBps, maxQuoteAgeMs, now: () => clock
  });
  let closed = false;
  const submitted = new Map();
  const filled = new Map();
  const rejected = new Map();

  function executeAtQuoteTime(input) {
    clock = input.quote.timestamp;
    try { return broker.submitMarketOrder(clone(input)); }
    finally { clock = now(); }
  }

  async function persistFill(input, order) {
    await ledger.append({
      eventId: eventId(input.clientOrderId, "filled"),
      type: "ORDER_FILLED",
      timestamp: order.filledAt,
      payload: { clientOrderId: input.clientOrderId, order, orderInput: input }
    });
    filled.set(input.clientOrderId, { input: clone(input), order: clone(order) });
  }

  async function persistRejection(input, error) {
    const message = error instanceof Error ? error.message : String(error);
    await ledger.append({
      eventId: eventId(input.clientOrderId, "rejected"),
      type: "ORDER_REJECTED",
      timestamp: now(),
      payload: { clientOrderId: input.clientOrderId, message, orderInput: input }
    });
    rejected.set(input.clientOrderId, { input: clone(input), message });
  }

  const recovered = await ledger.snapshot();
  for (const entry of recovered.events) {
    const payload = entry.payload;
    if (entry.type === "ORDER_SUBMITTED") submitted.set(payload.clientOrderId, clone(payload.orderInput));
    if (entry.type === "ORDER_FILLED") filled.set(payload.clientOrderId, {
      input: clone(payload.orderInput), order: clone(payload.order)
    });
    if (entry.type === "ORDER_REJECTED") rejected.set(payload.clientOrderId, {
      input: clone(payload.orderInput), message: payload.message
    });
  }

  // Rebuild broker balances and inventory by replaying durable fills in ledger order.
  for (const entry of recovered.events) {
    if (entry.type !== "ORDER_FILLED") continue;
    const input = entry.payload.orderInput;
    const replayed = executeAtQuoteTime(input);
    if (replayed.status !== "FILLED" || replayed.clientOrderId !== entry.payload.clientOrderId) {
      throw new Error("paper broker replay did not reproduce a recorded fill");
    }
  }

  // Complete submissions interrupted by a process crash before a terminal event.
  for (const [clientOrderId, input] of submitted) {
    if (filled.has(clientOrderId) || rejected.has(clientOrderId)) continue;
    try {
      const order = executeAtQuoteTime(input);
      await persistFill(input, order);
    } catch (error) {
      await persistRejection(input, error);
    }
  }
  clock = now();

  async function submitMarketOrder(input) {
    if (closed) throw new Error("paper session is closed");
    if (!input || typeof input !== "object") throw new TypeError("order input is required");
    const id = input.clientOrderId;
    if (filled.has(id)) {
      const prior = filled.get(id);
      if (canonical(prior.input) !== canonical(input)) throw new Error("clientOrderId already exists with different order input");
      return clone(prior.order);
    }
    if (rejected.has(id)) {
      const prior = rejected.get(id);
      if (canonical(prior.input) !== canonical(input)) throw new Error("clientOrderId already exists with different order input");
      throw new Error(prior.message);
    }
    if (submitted.has(id)) {
      if (canonical(submitted.get(id)) !== canonical(input)) throw new Error("clientOrderId already exists with different order input");
      throw new Error("order submission is already being recovered");
    }

    // Write-ahead intent: a crash after this point can be completed during recovery.
    await ledger.append({
      eventId: eventId(id, "submitted"),
      type: "ORDER_SUBMITTED",
      timestamp: now(),
      payload: { clientOrderId: id, orderInput: clone(input) }
    });
    submitted.set(id, clone(input));

    try {
      const order = executeAtQuoteTime(input);
      await persistFill(input, order);
      return clone(order);
    } catch (error) {
      await persistRejection(input, error);
      throw error;
    }
  }

  async function markToMarket(quotes) {
    if (closed) throw new Error("paper session is closed");
    clock = now();
    const mark = broker.markToMarket(quotes);
    await ledger.append({
      eventId: "mark_" + createHash("sha256").update(canonical({ timestamp: clock, mark })).digest("hex").slice(0, 40),
      type: "POSITION_MARKED",
      timestamp: clock,
      payload: mark
    });
    return clone(mark);
  }

  async function snapshot() {
    if (closed) throw new Error("paper session is closed");
    const [brokerState, ledgerState] = await Promise.all([Promise.resolve(broker.snapshot()), ledger.snapshot()]);
    return Object.freeze({ mode: "PAPER_ONLY", broker: brokerState, ledger: ledgerState });
  }

  async function close() {
    if (closed) return;
    await ledger.append({
      eventId: "session_stop_" + createHash("sha256").update(String(now()) + recovered.lastHash).digest("hex").slice(0, 32),
      type: "SESSION_STOPPED",
      timestamp: now(),
      payload: { mode: "PAPER_ONLY" }
    });
    await ledger.close();
    closed = true;
  }

  return Object.freeze({ submitMarketOrder, markToMarket, snapshot, close, filePath: ledger.filePath });
}
