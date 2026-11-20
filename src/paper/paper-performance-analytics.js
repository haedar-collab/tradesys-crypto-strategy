/**
 * Deterministic analytics for paper-ledger events.
 * Uses realized SELL fills for trade statistics and POSITION_MARKED events
 * for equity-curve drawdown. It never estimates missing marks or prices.
 */
const finite = (v) => Number.isFinite(v);
const round = (v) => Number(v.toFixed(8));

function unwrap(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (entry.type && entry.payload && typeof entry.payload === "object") return entry;
  if (entry.type === "ORDER_FILLED" || entry.type === "POSITION_MARKED") {
    return { type: entry.type, timestamp: entry.at ?? entry.timestamp, payload: entry };
  }
  return null;
}

function periodKey(timestamp, period) {
  const d = new Date(timestamp);
  if (period === "daily") return d.toISOString().slice(0, 10);
  if (period === "monthly") return d.toISOString().slice(0, 7);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

function groupPnl(trades, period) {
  const buckets = new Map();
  for (const trade of trades) {
    const key = periodKey(trade.timestamp, period);
    buckets.set(key, (buckets.get(key) ?? 0) + trade.realizedPnl);
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([period, realizedPnl]) => Object.freeze({ period, realizedPnl: round(realizedPnl) }));
}

export function buildPaperPerformanceReport({
  events,
  initialEquity,
  equitySnapshots = []
} = {}) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array");
  if (!finite(initialEquity) || initialEquity <= 0) throw new RangeError("initialEquity must be positive");
  if (!Array.isArray(equitySnapshots)) throw new TypeError("equitySnapshots must be an array");

  const normalized = events.map(unwrap).filter(Boolean);
  const fills = normalized.filter((e) => e.type === "ORDER_FILLED").map((e) => {
    const order = e.payload?.order ?? e.payload;
    const timestamp = e.timestamp ?? order?.filledAt ?? order?.at;
    if (!order || !Number.isSafeInteger(timestamp) || timestamp < 0 ||
        !finite(order.fee) || order.fee < 0 || !finite(order.realizedPnl)) {
      throw new TypeError("ORDER_FILLED event has invalid order metrics");
    }
    return { order, timestamp };
  }).sort((a, b) => a.timestamp - b.timestamp);

  const closedTrades = fills.filter(({ order }) => order.side === "SELL")
    .map(({ order, timestamp }) => ({ timestamp, symbol: order.symbol, realizedPnl: order.realizedPnl }));
  const wins = closedTrades.filter((t) => t.realizedPnl > 0);
  const losses = closedTrades.filter((t) => t.realizedPnl < 0);
  const grossProfit = wins.reduce((s, t) => s + t.realizedPnl, 0);
  const grossLoss = -losses.reduce((s, t) => s + t.realizedPnl, 0);
  const netRealizedPnl = closedTrades.reduce((s, t) => s + t.realizedPnl, 0);
  const totalFees = fills.reduce((s, x) => s + x.order.fee, 0);

  const marks = equitySnapshots.map((x) => {
    if (!x || !Number.isSafeInteger(x.timestamp) || x.timestamp < 0 ||
        !finite(x.equity) || x.equity <= 0) throw new TypeError("equity snapshot is invalid");
    return { timestamp: x.timestamp, equity: x.equity };
  }).sort((a, b) => a.timestamp - b.timestamp);
  let peak = initialEquity;
  let maxDrawdownPct = 0;
  for (const mark of marks) {
    peak = Math.max(peak, mark.equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, (peak - mark.equity) / peak * 100);
  }

  const count = closedTrades.length;
  return Object.freeze({
    status: "COMPLETE",
    initialEquity: round(initialEquity),
    closedTradeCount: count,
    winCount: wins.length,
    lossCount: losses.length,
    winRatePct: count ? round(wins.length / count * 100) : null,
    grossProfit: round(grossProfit),
    grossLoss: round(grossLoss),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : null,
    netRealizedPnl: round(netRealizedPnl),
    netRealizedReturnPct: round(netRealizedPnl / initialEquity * 100),
    expectancyPerClosedTrade: count ? round(netRealizedPnl / count) : null,
    totalFees: round(totalFees),
    maxDrawdownPct: round(maxDrawdownPct),
    equityMarkCount: marks.length,
    daily: Object.freeze(groupPnl(closedTrades, "daily")),
    weekly: Object.freeze(groupPnl(closedTrades, "weekly")),
    monthly: Object.freeze(groupPnl(closedTrades, "monthly")),
    limitations: Object.freeze([
      "Trade statistics count realized SELL executions; partial exits count as separate executions.",
      "Maximum drawdown uses supplied equity snapshots and does not interpolate unobserved intraperiod lows.",
      "Open-position unrealized PnL is excluded from realized return and expectancy."
    ])
  });
}
