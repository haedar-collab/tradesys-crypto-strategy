/**
 * Mark-to-market accounting helpers for long-only Spot backtests.
 * Equity includes realized cash equity plus open-position net contribution.
 * Estimated liquidation fee is reserved on remaining quantity at the mark.
 */
export function markPosition(position, markPrice, feeRate = 0, slippageRate = 0) {
  if (!position || !Number.isFinite(markPrice) || markPrice <= 0 ||
      !Number.isFinite(feeRate) || feeRate < 0 ||
      !Number.isFinite(slippageRate) || slippageRate < 0 || slippageRate >= 1 ||
      !Number.isFinite(position.quantity) || position.quantity < 0 ||
      !Number.isFinite(position.remaining) || position.remaining < 0 || position.remaining > 1 ||
      !Number.isFinite(position.entryFill) || position.entryFill <= 0 ||
      !Number.isFinite(position.entryFee) || position.entryFee < 0 ||
      !Number.isFinite(position.grossPnl) || !Number.isFinite(position.exitFees)) {
    throw new TypeError("invalid position or mark-to-market inputs");
  }
  const remainingQty = position.quantity * position.remaining;
  const liquidationPrice = markPrice * (1 - slippageRate);
  const unrealizedGrossPnl = (markPrice - position.entryFill) * remainingQty;
  const estimatedExitFee = liquidationPrice * remainingQty * feeRate;
  const netContribution = position.grossPnl - position.entryFee - position.exitFees +
    unrealizedGrossPnl - estimatedExitFee;
  return {
    markPrice,
    remainingQty,
    unrealizedGrossPnl,
    estimatedExitFee,
    netContribution
  };
}

export function calculateMarkedEquity(realizedEquity, positions, marks, feeRate = 0, slippageRate = 0) {
  if (!Number.isFinite(realizedEquity) || realizedEquity <= 0 ||
      !Array.isArray(positions) || !marks || typeof marks !== "object") {
    throw new TypeError("invalid marked-equity inputs");
  }
  let unrealizedNet = 0;
  const detail = positions.map(position => {
    const mark = marks[position.symbol];
    const result = markPosition(position, mark, feeRate, slippageRate);
    unrealizedNet += result.netContribution;
    return { symbol: position.symbol, ...result };
  });
  return { equity: realizedEquity + unrealizedNet, unrealizedNet, positions: detail };
}

export function updateDrawdown(peakEquity, markedEquity) {
  if (!Number.isFinite(peakEquity) || peakEquity <= 0 ||
      !Number.isFinite(markedEquity) || markedEquity <= 0) {
    throw new TypeError("invalid equity for drawdown calculation");
  }
  const peak = Math.max(peakEquity, markedEquity);
  return {
    peakEquity: peak,
    drawdownPct: Math.max(0, (peak - markedEquity) / peak * 100)
  };
}
