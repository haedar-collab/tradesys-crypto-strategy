import { createHash } from "node:crypto";
import { validateBinanceSpotQuote } from "../data/binance-spot-quote-contract.js";
import { evaluateStrategyAcceptance } from "../validation/strategy-acceptance.js";
import { submitStrategyBuyToPaper } from "./strategy-paper-execution.js";

export const PAPER_TRADING_DEFAULTS = Object.freeze({
  tickIntervalMs: 5_000,
  markIntervalMs: 30_000,
  riskPerTradePct: 0.5,
  maxPositionPct: 20,
  maxOpenPositions: 3,
  minNotional: 10,
  minRR: 1.5,
  maxEntryDriftPct: 1,
  slippageBps: 5,
  maxQuoteAgeMs: 5_000,
  quantityDecimals: 8
});
const EXIT_FRACTIONS = Object.freeze({ tp1: 0.4, tp2: 0.4 });

const floorTo = (value, decimals) => Math.floor(value * 10 ** decimals) / 10 ** decimals;
const shortHash = value => createHash("sha256").update(value).digest("hex").slice(0, 24);

/**
 * Deterministic id for one screener setup. The same setup (symbol, zone and
 * plan levels) always maps to the same clientOrderId, so it can be entered at
 * most once, also across restarts and repeated screener refreshes.
 */
export function paperSetupOrderId(symbol, candidate) {
  const zone = candidate.zone ?? {};
  const plan = candidate.plan;
  return "pt_" + shortHash([symbol, zone.lo, zone.hi, plan.stop, plan.tp1, plan.tp2, plan.tp3].join("|"));
}

/**
 * Derive the managed lot for each open position from durable ledger fills:
 * the most recent BUY carrying a paperPlan, its fill price/quantity, and how
 * much of it was already sold by this engine. No separate state is stored.
 */
export function deriveManagedLots(events, positions) {
  const held = new Map(positions.map(p => [p.symbol, p.quantity]));
  const lots = new Map();
  const sold = new Map();
  for (const event of events) {
    if (event.type !== "ORDER_FILLED") continue;
    const order = event.payload?.order;
    const input = event.payload?.orderInput;
    if (!order || !input) continue;
    if (order.side === "BUY" && input.paperPlan && held.has(order.symbol)) {
      lots.set(order.symbol, {
        id: order.clientOrderId, symbol: order.symbol, plan: input.paperPlan,
        entryPrice: order.fillPrice, initialQuantity: order.quantity
      });
    }
    if (order.side === "SELL") {
      const lotId = order.clientOrderId.replace(/_(tp1|tp2|exit)$/, "");
      sold.set(lotId, (sold.get(lotId) ?? 0) + order.quantity);
    }
  }
  return [...lots.values()].map(lot => {
    const soldFraction = (sold.get(lot.id) ?? 0) / lot.initialQuantity;
    const stage = soldFraction < 0.2 ? 0 : soldFraction < 0.6 ? 1 : 2;
    return Object.freeze({
      ...lot, stage, heldQuantity: held.get(lot.symbol),
      activeStop: stage === 0 ? lot.plan.stop : lot.entryPrice
    });
  });
}

/**
 * PAPER_ONLY trading loop: marks open positions, manages plan exits, and opens
 * new positions from screener BUY_CANDIDATEs only when the supplied strategy
 * evidence passes the acceptance gate. It never contacts an exchange order
 * endpoint; all orders go through the persistent paper session.
 */
export function createPaperTradingEngine({
  session,
  getFeedSnapshot,
  getScreenerSnapshot,
  acceptanceReport = null,
  options = {},
  now = () => Date.now(),
  log = () => {},
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
} = {}) {
  if (!session || typeof session.submitMarketOrder !== "function" ||
      typeof session.markToMarket !== "function" || typeof session.snapshot !== "function") {
    throw new TypeError("a persistent paper session is required");
  }
  if (typeof getFeedSnapshot !== "function" || typeof getScreenerSnapshot !== "function") {
    throw new TypeError("getFeedSnapshot and getScreenerSnapshot must be functions");
  }
  const config = { ...PAPER_TRADING_DEFAULTS, ...options };
  for (const [key, value] of Object.entries(config)) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(key + " must be a non-negative number");
  }
  if (config.riskPerTradePct <= 0 || config.riskPerTradePct > 5) throw new RangeError("riskPerTradePct must be in (0, 5]");
  if (config.maxPositionPct <= 0 || config.maxPositionPct > 100) throw new RangeError("maxPositionPct must be in (0, 100]");

  const acceptance = acceptanceReport ? evaluateStrategyAcceptance(acceptanceReport)
    : Object.freeze({ decision: "NOT_EVALUATED", eligibleForPaperTrading: false, reasons: ["NO_ACCEPTANCE_REPORT"] });
  const entriesEnabled = acceptance.decision === "ACCEPT" && acceptance.eligibleForPaperTrading === true;

  let lastMarkAt = -Infinity;
  let lastTick = null;
  let started = false, timer = null, inFlight = null;

  function healthyQuotes() {
    const snapshot = getFeedSnapshot();
    const quotes = {};
    for (const [symbol, feed] of Object.entries(snapshot?.feeds ?? {})) {
      const quote = feed?.lastQuote;
      if (!feed?.healthy || !quote) continue;
      const check = validateBinanceSpotQuote({ quote, symbol, now: now(), maxAgeMs: config.maxQuoteAgeMs });
      if (check.valid) quotes[symbol] = quote;
    }
    return quotes;
  }

  async function submit(input, actions) {
    try {
      const order = await session.submitMarketOrder(input);
      actions.push({ type: input.side, symbol: input.symbol, clientOrderId: input.clientOrderId, quantity: order.quantity, price: order.fillPrice });
      log("[paper] " + input.side + " " + input.symbol + " qty=" + order.quantity + " @ " + order.fillPrice + " (" + input.clientOrderId + ")");
    } catch (error) {
      actions.push({ type: input.side + "_REJECTED", symbol: input.symbol, clientOrderId: input.clientOrderId, reason: error.message });
    }
  }

  async function manageExits(lots, quotes, actions) {
    for (const lot of lots) {
      const quote = quotes[lot.symbol];
      if (!quote) { actions.push({ type: "EXIT_SKIPPED", symbol: lot.symbol, reason: "NO_HEALTHY_QUOTE" }); continue; }
      const bid = quote.bid;
      const sell = (suffix, quantity, reason) => submit({
        clientOrderId: lot.id + "_" + suffix, symbol: lot.symbol, side: "SELL",
        quantity: floorTo(Math.min(quantity, lot.heldQuantity), config.quantityDecimals), quote, exitReason: reason
      }, actions);
      // Conservative ordering: the active stop is checked before any target.
      if (bid <= lot.activeStop) await sell("exit", lot.heldQuantity, lot.stage === 0 ? "STOP_LOSS" : "BREAKEVEN_STOP");
      else if (bid >= lot.plan.tp3 && lot.stage === 2) await sell("exit", lot.heldQuantity, "TP3");
      else if (bid >= lot.plan.tp2 && lot.stage === 1) await sell("tp2", lot.initialQuantity * EXIT_FRACTIONS.tp2, "TP2");
      else if (bid >= lot.plan.tp1 && lot.stage === 0) await sell("tp1", lot.initialQuantity * EXIT_FRACTIONS.tp1, "TP1");
    }
  }

  async function considerEntries(state, quotes, actions) {
    if (!entriesEnabled) return { blocked: "ACCEPTANCE_" + acceptance.decision };
    if (state.risk?.halted) return { blocked: "KILL_SWITCH_LATCHED" };
    const positions = state.broker.positions;
    if (positions.length >= config.maxOpenPositions) return { blocked: "MAX_OPEN_POSITIONS" };
    if (positions.some(p => !quotes[p.symbol])) return { blocked: "HELD_SYMBOL_QUOTE_UNAVAILABLE" };
    const screener = (await getScreenerSnapshot())?.screener;
    if (!screener || !["COMPLETE", "PARTIAL"].includes(screener.status)) return { blocked: "SCREENER_" + (screener?.status ?? "UNAVAILABLE") };
    const equity = state.broker.cash + positions.reduce((sum, p) => sum + p.quantity * quotes[p.symbol].bid, 0);
    const held = new Set(positions.map(p => p.symbol));
    // Setups that already reached a terminal state are never re-entered.
    const traded = new Set(state.ledger.events
      .filter(e => e.type === "ORDER_FILLED" || e.type === "ORDER_REJECTED")
      .map(e => e.payload?.clientOrderId));
    for (const result of screener.results ?? []) {
      const plan = result.candidate?.plan;
      if (result.state !== "BUY_CANDIDATE" || !plan || held.has(result.symbol)) continue;
      const quote = quotes[result.symbol];
      if (!quote) { actions.push({ type: "ENTRY_SKIPPED", symbol: result.symbol, reason: "NO_HEALTHY_QUOTE" }); continue; }
      const clientOrderId = paperSetupOrderId(result.symbol, result.candidate);
      if (traded.has(clientOrderId)) { actions.push({ type: "ENTRY_SKIPPED", symbol: result.symbol, reason: "SETUP_ALREADY_TRADED" }); continue; }
      const fill = quote.ask * (1 + config.slippageBps / 10_000);
      const reference = Number.isFinite(plan.evaluatedFill) ? plan.evaluatedFill : plan.entry;
      const skip = reason => actions.push({ type: "ENTRY_SKIPPED", symbol: result.symbol, reason });
      if (!(fill > plan.stop && fill < plan.tp1)) { skip("PRICE_OUTSIDE_PLAN"); continue; }
      if ((plan.tp2 - fill) / (fill - plan.stop) < config.minRR) { skip("CURRENT_RR_BELOW_MINIMUM"); continue; }
      if (Number.isFinite(reference) && quote.ask > reference * (1 + config.maxEntryDriftPct / 100)) { skip("ENTRY_DRIFT_EXCEEDED"); continue; }
      const riskQty = equity * config.riskPerTradePct / 100 / (fill - plan.stop);
      const capQty = equity * config.maxPositionPct / 100 / fill;
      const quantity = floorTo(Math.min(riskQty, capQty), config.quantityDecimals);
      if (!(quantity > 0) || quantity * fill < config.minNotional) { skip("BELOW_MIN_NOTIONAL"); continue; }
      try {
        const outcome = await submitStrategyBuyToPaper({
          session, acceptanceReport,
          signal: { clientOrderId, symbol: result.symbol, side: "BUY", quantity },
          quote, plan
        });
        if (outcome.status === "SUBMITTED_TO_PAPER") {
          actions.push({ type: "BUY", symbol: result.symbol, clientOrderId, quantity: outcome.order.quantity, price: outcome.order.fillPrice });
          log("[paper] BUY " + result.symbol + " qty=" + outcome.order.quantity + " @ " + outcome.order.fillPrice + " (" + clientOrderId + ")");
        } else skip("ACCEPTANCE_" + outcome.reason);
      } catch (error) {
        // Deterministic ids make a rejected setup stay rejected (no retry storms).
        actions.push({ type: "BUY_REJECTED", symbol: result.symbol, clientOrderId, reason: error.message });
      }
      return { entered: true }; // at most one entry per tick
    }
    return {};
  }

  async function tick() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const actions = [];
      const startedAt = now();
      let state = await session.snapshot();
      const quotes = healthyQuotes();
      const held = state.broker.positions;
      // Fresh marks keep the session risk gate (and kill switch) current.
      if (held.length > 0 && startedAt - lastMarkAt >= config.markIntervalMs) {
        if (held.every(p => quotes[p.symbol])) {
          await session.markToMarket(Object.fromEntries(held.map(p => [p.symbol, quotes[p.symbol]])));
          lastMarkAt = startedAt;
          actions.push({ type: "MARK", symbols: held.map(p => p.symbol) });
        } else actions.push({ type: "MARK_SKIPPED", reason: "HELD_SYMBOL_QUOTE_UNAVAILABLE" });
      }
      await manageExits(deriveManagedLots(state.ledger.events, held), quotes, actions);
      state = await session.snapshot();
      const entry = await considerEntries(state, quotes, actions);
      lastTick = Object.freeze({ at: startedAt, actions: Object.freeze(actions), entriesBlocked: entry.blocked ?? null });
      return lastTick;
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  function schedule() {
    if (!started) return;
    timer = setTimeoutFn(async () => {
      timer = null;
      try { await tick(); } catch (error) { log("[paper] tick failed: " + (error?.message ?? error)); }
      schedule();
    }, config.tickIntervalMs);
    timer?.unref?.();
  }

  return Object.freeze({
    tick,
    start() { if (started) return; started = true; schedule(); },
    async stop() {
      started = false;
      if (timer !== null) clearTimeoutFn(timer);
      timer = null;
      if (inFlight) await inFlight.catch(() => {});
    },
    status: () => Object.freeze({
      enabled: true, entriesEnabled,
      acceptance: Object.freeze({ decision: acceptance.decision, eligibleForPaperTrading: acceptance.eligibleForPaperTrading === true }),
      config: Object.freeze({ ...config }),
      lastTick
    })
  });
}
