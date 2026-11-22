import { evaluateStrategyAcceptance } from "../validation/strategy-acceptance.js";

/**
 * Evaluate supplied strategy evidence immediately before a paper BUY.
 * Only an internally computed ACCEPT decision can reach the persistent session.
 * This adapter is signal-only/paper-only and never submits exchange orders.
 */
export async function submitStrategyBuyToPaper({
  session,
  acceptanceReport,
  signal,
  quote,
  plan = null
} = {}) {
  if (plan !== null && (typeof plan !== "object" ||
      !["stop", "tp1", "tp2", "tp3"].every(key => Number.isFinite(plan[key]) && plan[key] > 0) ||
      !(plan.stop < plan.tp1 && plan.tp1 < plan.tp2 && plan.tp2 < plan.tp3))) {
    throw new TypeError("plan must contain ascending positive stop < tp1 < tp2 < tp3");
  }
  if (!session || typeof session.submitMarketOrder !== "function") {
    throw new TypeError("persistent paper session is required");
  }
  if (!signal || typeof signal !== "object" || Array.isArray(signal)) {
    throw new TypeError("strategy signal is required");
  }
  if (signal.side !== "BUY") {
    throw new RangeError("strategy paper entry adapter accepts BUY signals only");
  }
  const acceptance = evaluateStrategyAcceptance(acceptanceReport);
  if (acceptance.decision !== "ACCEPT" || acceptance.eligibleForPaperTrading !== true) {
    return Object.freeze({
      status: "BLOCKED",
      reason: acceptance.decision,
      acceptance
    });
  }
  if (!quote || typeof quote !== "object") throw new TypeError("market quote is required");
  const order = await session.submitMarketOrder({
    clientOrderId: signal.clientOrderId,
    symbol: signal.symbol,
    side: "BUY",
    quantity: signal.quantity,
    quote,
    strategyAcceptance: acceptance,
    // Persisted with the order intent so exits can be derived from the ledger.
    ...(plan ? { paperPlan: { stop: plan.stop, tp1: plan.tp1, tp2: plan.tp2, tp3: plan.tp3 } } : {})
  });
  return Object.freeze({
    status: "SUBMITTED_TO_PAPER",
    mode: "PAPER_ONLY",
    acceptance,
    order
  });
}
