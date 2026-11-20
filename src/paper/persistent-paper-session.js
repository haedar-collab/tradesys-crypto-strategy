import { createHash } from "node:crypto";
import { createPaperBroker } from "./paper-broker.js";
import { createPersistentPaperLedger } from "./persistent-paper-ledger.js";
import { createPaperRiskMonitor } from "../risk/paper-risk-monitor.js";

const clone = (value) => structuredClone(value);
const canonical = (value) => JSON.stringify(value);
const eventId = (clientOrderId, suffix) =>
  "paper_" + createHash("sha256").update(clientOrderId).digest("hex").slice(0, 32) + "_" + suffix;

/**
 * Event-sourced paper session with a persistent, fail-closed risk gate.
 * BUY entries are checked against portfolio marks; SELL exits remain permitted
 * while the kill switch is latched. This module never connects to an exchange.
 */
export async function createPersistentPaperSession({
  filePath,
  initialCash = 10_000,
  feeBps = 10,
  slippageBps = 5,
  maxQuoteAgeMs = 5_000,
  riskMarkMaxAgeMs = 60_000,
  dailyLossLimitPct = 3,
  maxDrawdownPct = 10,
  maxExposurePct = 80,
  now = () => Date.now()
} = {}) {
  if (typeof now !== "function") throw new TypeError("now must be a function");
  if (!Number.isSafeInteger(riskMarkMaxAgeMs) || riskMarkMaxAgeMs < 0) {
    throw new RangeError("riskMarkMaxAgeMs must be a non-negative safe integer");
  }
  let clock = now();
  if (!Number.isSafeInteger(clock) || clock < 0) throw new TypeError("now must return UTC epoch milliseconds");
  const ledger = await createPersistentPaperLedger({ filePath });
  const broker = createPaperBroker({
    initialCash, feeBps, slippageBps, maxQuoteAgeMs, now: () => clock
  });
  let closed = false;
  let submissionQueue = Promise.resolve();
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
  let latestMark = null;
  let lastFillTimestamp = -1;
  let latestRiskState = null;
  for (const entry of recovered.events) {
    const payload = entry.payload;
    if (entry.type === "ORDER_SUBMITTED") submitted.set(payload.clientOrderId, clone(payload.orderInput));
    if (entry.type === "ORDER_FILLED") {
      filled.set(payload.clientOrderId, { input: clone(payload.orderInput), order: clone(payload.order) });
      lastFillTimestamp = Math.max(lastFillTimestamp, entry.timestamp);
    }
    if (entry.type === "ORDER_REJECTED") rejected.set(payload.clientOrderId, {
      input: clone(payload.orderInput), message: payload.message
    });
    if (entry.type === "POSITION_MARKED") latestMark = entry;
    if (entry.type === "RISK_EVENT" && payload.state) latestRiskState = clone(payload.state);
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

  // A write-ahead intent without a durable fill is ambiguous after a crash.
  // Never auto-execute it during recovery; record a safe rejection for operator review.
  for (const [clientOrderId, input] of submitted) {
    if (filled.has(clientOrderId) || rejected.has(clientOrderId)) continue;
    await persistRejection(input, new Error("submission interrupted before durable fill; manual review required"));
  }
  clock = now();

  const riskMonitor = createPaperRiskMonitor({
    dailyLossLimitPct, maxDrawdownPct, maxExposurePct, now,
    initialState: latestRiskState
  });

  async function persistRiskState(reason) {
    const state = { ...riskMonitor.status(), events: [] };
    const timestamp = now();
    const ledgerState = await ledger.snapshot();
    const digest = createHash("sha256").update(canonical({ reason, timestamp, sequence: ledgerState.lastSequence, state })).digest("hex");
    await ledger.append({
      eventId: "risk_" + digest.slice(0, 48),
      type: "RISK_EVENT",
      timestamp,
      payload: { reason, state }
    });
  }

  // Establish the original equity baseline only for a genuinely new session.
  if (!latestRiskState && recovered.events.length === 0) {
    riskMonitor.evaluate({ equity: initialCash, positions: [], timestamp: now() });
    await persistRiskState("SESSION_START_BASELINE");
  }

  function currentRiskSnapshot() {
    const state = broker.snapshot();
    if (state.positions.length === 0) {
      return { equity: state.cash, positions: [], timestamp: now() };
    }
    if (!latestMark || latestMark.timestamp < lastFillTimestamp ||
        now() < latestMark.timestamp || now() - latestMark.timestamp > riskMarkMaxAgeMs) return null;
    const mark = latestMark.payload;
    if (!Number.isFinite(mark.equity) || mark.equity <= 0 || !Array.isArray(mark.marks)) return null;
    const bySymbol = new Map(mark.marks.map(x => [x.symbol, x]));
    const positions = state.positions.map(p => {
      const m = bySymbol.get(p.symbol);
      if (!m || !Number.isFinite(m.markPrice) || m.markPrice <= 0 ||
          !Number.isFinite(m.quantity) || Math.abs(m.quantity - p.quantity) > 1e-9) return null;
      return { quantity: p.quantity, markPrice: m.markPrice };
    });
    if (positions.some(p => p === null)) return null;
    return { equity: mark.equity, positions, timestamp: latestMark.timestamp };
  }

  function projectedBuySnapshot(input) {
    const base = currentRiskSnapshot();
    if (!base) return null;
    const state = broker.snapshot();
    const slip = slippageBps / 10_000;
    const estimatedFill = input.quote.ask * (1 + slip);
    const estimatedFee = input.quantity * estimatedFill * feeBps / 10_000;
    const existingMarks = latestMark?.payload?.marks ?? [];
    const marks = new Map(existingMarks.map(x => [x.symbol, { quantity: x.quantity, markPrice: x.markPrice }]));
    const prior = marks.get(input.symbol);
    marks.set(input.symbol, {
      quantity: (prior?.quantity ?? 0) + input.quantity,
      markPrice: input.quote.bid
    });
    const positions = [...marks.values()];
    const priorMarketValue = existingMarks.reduce((s, x) => s + x.quantity * x.markPrice, 0);
    const replacedValue = prior ? prior.quantity * prior.markPrice : 0;
    const projectedMarketValue = priorMarketValue - replacedValue +
      ((prior?.quantity ?? 0) + input.quantity) * input.quote.bid;
    const projectedCash = state.cash - input.quantity * estimatedFill - estimatedFee;
    const equity = projectedCash + projectedMarketValue;
    if (!Number.isFinite(equity) || equity <= 0) return null;
    return { equity, positions, timestamp: now() };
  }

  async function evaluateEntryRisk(input) {
    if (input.side === "SELL") return { allowed: true, reason: "EXIT_ORDERS_REMAIN_ALLOWED" };
    if (input.riskGate?.allowed === false) return { allowed: false, reason: "UPSTREAM_RISK_VETO" };
    const snapshot = projectedBuySnapshot(input);
    if (!snapshot) return { allowed: false, reason: "RISK_DATA_UNAVAILABLE" };
    const result = riskMonitor.evaluate(snapshot);
    await persistRiskState("ORDER_ENTRY_CHECK");
    return { allowed: result.allowNewEntries === true, reason: result.reasons.join(",") || (result.halted ? "KILL_SWITCH_LATCHED" : "RISK_ALLOWED"), result };
  }

  async function submitMarketOrderSerial(input) {
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

    await ledger.append({
      eventId: eventId(id, "submitted"),
      type: "ORDER_SUBMITTED",
      timestamp: now(),
      payload: { clientOrderId: id, orderInput: clone(input) }
    });
    submitted.set(id, clone(input));

    try {
      const risk = await evaluateEntryRisk(input);
      if (!risk.allowed) throw new Error("paper risk gate blocked entry: " + risk.reason);
      const safeInput = { ...clone(input), riskGate: { allowed: true, source: "PERSISTENT_SESSION_RISK_MONITOR" } };
      const order = executeAtQuoteTime(safeInput);
      await persistFill(input, order);
      lastFillTimestamp = Math.max(lastFillTimestamp, order.filledAt);
      return clone(order);
    } catch (error) {
      await persistRejection(input, error);
      throw error;
    }
  }

  function submitMarketOrder(input) {
    const operation = submissionQueue.then(() => submitMarketOrderSerial(input));
    submissionQueue = operation.catch(() => {});
    return operation;
  }

  async function markToMarket(quotes) {
    if (closed) throw new Error("paper session is closed");
    await submissionQueue;
    clock = now();
    const mark = broker.markToMarket(quotes);
    const entry = await ledger.append({
      eventId: "mark_" + createHash("sha256").update(canonical({ timestamp: clock, mark })).digest("hex").slice(0, 40),
      type: "POSITION_MARKED",
      timestamp: clock,
      payload: mark
    });
    latestMark = entry;
    const risk = riskMonitor.evaluate({
      equity: mark.equity,
      positions: mark.marks,
      timestamp: clock
    });
    await persistRiskState("MARK_TO_MARKET_EVALUATION");
    return Object.freeze({ ...clone(mark), risk: clone(risk) });
  }

  async function activateKillSwitch(reason = "MANUAL_KILL_SWITCH") {
    if (closed) throw new Error("paper session is closed");
    riskMonitor.activate(reason);
    await persistRiskState("MANUAL_KILL_SWITCH");
    return riskMonitor.status();
  }

  async function resetKillSwitch() {
    if (closed) throw new Error("paper session is closed");
    const snapshot = currentRiskSnapshot();
    if (!snapshot) throw new Error("cannot reset kill switch: fresh portfolio marks are unavailable");
    riskMonitor.evaluate(snapshot);
    const result = riskMonitor.reset(snapshot);
    await persistRiskState("MANUAL_KILL_SWITCH_RESET");
    return result;
  }

  async function snapshot() {
    if (closed) throw new Error("paper session is closed");
    const [brokerState, ledgerState] = await Promise.all([Promise.resolve(broker.snapshot()), ledger.snapshot()]);
    return Object.freeze({
      mode: "PAPER_ONLY", broker: brokerState, ledger: ledgerState,
      risk: riskMonitor.status()
    });
  }

  async function close() {
    if (closed) return;
    await submissionQueue;
    await ledger.append({
      eventId: "session_stop_" + createHash("sha256").update(String(now()) + recovered.lastHash).digest("hex").slice(0, 32),
      type: "SESSION_STOPPED",
      timestamp: now(),
      payload: { mode: "PAPER_ONLY" }
    });
    await ledger.close();
    closed = true;
  }

  return Object.freeze({
    submitMarketOrder, markToMarket, snapshot, close,
    activateKillSwitch, resetKillSwitch,
    riskStatus: () => riskMonitor.status(),
    filePath: ledger.filePath
  });
}
