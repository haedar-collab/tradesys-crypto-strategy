import { calculateMarkedEquity, updateDrawdown } from "./mark-to-market.js";

/**
 * Build a deterministic marked-equity snapshot at one synchronized bar close.
 * Call once per bar after all exits for that bar have been processed.
 */
export function buildEquitySnapshot({
  timestamp,
  realizedEquity,
  positions,
  marks,
  previousPeakEquity,
  feeRate = 0,
  slippageRate = 0
}) {
  if (!Number.isFinite(timestamp)) throw new TypeError("timestamp must be finite");
  const marked = calculateMarkedEquity(realizedEquity, positions, marks, feeRate, slippageRate);
  const drawdown = updateDrawdown(previousPeakEquity, marked.equity);
  return {
    timestamp,
    realizedEquity,
    markedEquity: marked.equity,
    unrealizedNet: marked.unrealizedNet,
    peakEquity: drawdown.peakEquity,
    drawdownPct: drawdown.drawdownPct,
    positions: marked.positions
  };
}

/** Pure admission gate: block new risk once marked drawdown breaches limit. */
export function markedDrawdownGate(snapshot, limitPct) {
  if (!snapshot || !Number.isFinite(snapshot.drawdownPct) ||
      !Number.isFinite(limitPct) || limitPct <= 0 || limitPct >= 100) {
    throw new TypeError("invalid marked drawdown gate inputs");
  }
  return {
    allowNewEntries: snapshot.drawdownPct < limitPct,
    state: snapshot.drawdownPct >= limitPct ? "BLOCKED" : "NORMAL",
    drawdownPct: snapshot.drawdownPct,
    limitPct
  };
}
