const finite = Number.isFinite;
const clone = (value) => value == null ? value : structuredClone(value);

/**
 * Read-only projection for a paper-trading dashboard.
 * It intentionally accepts snapshots, never a session/broker/runtime handle,
 * and exposes no order, ledger-write, or risk-reset operation.
 */
export function buildPaperDashboardViewModel({
  feedStatus = null,
  quote = null,
  signal = null,
  acceptance = null,
  screener = null,
  ledgerSnapshot = null,
  performanceReport = null,
  riskStatus = null,
  positions = [],
  now = Date.now(),
  maxQuoteAgeMs = 5_000
} = {}) {
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("now must be a non-negative UTC epoch timestamp");
  if (!Number.isSafeInteger(maxQuoteAgeMs) || maxQuoteAgeMs < 0) throw new RangeError("maxQuoteAgeMs must be non-negative");
  if (!Array.isArray(positions)) throw new TypeError("positions must be an array");

  const quoteTimestamp = quote?.timestamp;
  const quoteAgeMs = Number.isSafeInteger(quoteTimestamp) && quoteTimestamp >= 0
    ? Math.max(0, now - quoteTimestamp) : null;
  const quoteValid = quoteAgeMs !== null && quoteTimestamp <= now &&
    finite(quote?.bid) && quote.bid > 0 && finite(quote?.ask) &&
    quote.ask >= quote.bid && quote.ask > 0;
  const aggregateFeedState = feedStatus?.state ?? feedStatus?.status;
  const feedConnected = aggregateFeedState === "CONNECTED" ||
    feedStatus?.connected === true;
  const feedState = aggregateFeedState === "DEGRADED" ? "DEGRADED" :
    aggregateFeedState === "WAIT_DATA" ? "WAIT_DATA" :
    aggregateFeedState === "STOPPED" || aggregateFeedState === "DISCONNECTED" ? "DISCONNECTED" :
    !feedConnected ? "DISCONNECTED" :
    !quoteValid ? "WAIT_QUOTE" :
    quoteAgeMs > maxQuoteAgeMs ? "STALE" : "HEALTHY";
  const feedSymbols = Object.entries(feedStatus?.feeds ?? {}).map(([symbol, feed]) => ({
    symbol,
    state: feed?.state ?? "UNKNOWN",
    healthy: feed?.healthy === true,
    reason: feed?.reason ?? null,
    ageMs: finite(feed?.ageMs) ? feed.ageMs : null
  }));

  const ledgerComplete = ledgerSnapshot?.status === "COMPLETE" &&
    Array.isArray(ledgerSnapshot.events) &&
    Number.isSafeInteger(ledgerSnapshot.eventCount) &&
    ledgerSnapshot.eventCount === ledgerSnapshot.events.length &&
    ledgerSnapshot.lastSequence === ledgerSnapshot.eventCount;
  const analyticsAvailable = ledgerComplete &&
    performanceReport?.status === "COMPLETE";
  const normalizedPositions = positions.map((p) => {
    if (!p || typeof p.symbol !== "string" || !finite(p.quantity) || p.quantity < 0) {
      throw new TypeError("dashboard position snapshot is invalid");
    }
    return Object.freeze({
      symbol: p.symbol,
      quantity: p.quantity,
      markPrice: finite(p.markPrice) && p.markPrice > 0 ? p.markPrice : null,
      marketValue: finite(p.markPrice) && p.markPrice > 0 ? p.quantity * p.markPrice : null,
      markStatus: finite(p.markPrice) && p.markPrice > 0 ? "MARKED" : "UNMARKED"
    });
  });

  const halted = riskStatus?.halted === true;
  const riskState = !riskStatus ? "UNKNOWN" :
    halted ? "KILL_SWITCH_LATCHED" :
    riskStatus.status === "WAIT_DATA" ? "WAIT_DATA" :
    riskStatus.allowed === true || riskStatus.allowNewEntries === true ? "ALLOWED" :
    riskStatus.allowed === false ? "BLOCKED" : "UNKNOWN";

  const acceptanceDecision = signal?.decision ?? signal?.acceptanceDecision ??
    acceptance?.decision ?? acceptance?.status ?? "NOT_EVALUATED";
  const screenerResults = Array.isArray(screener?.results) ? screener.results.map(item => Object.freeze({
    symbol: String(item.symbol ?? "UNKNOWN"),
    state: String(item.state ?? "UNKNOWN"),
    reasons: Object.freeze(Array.isArray(item.candidate?.reasons) ? [...item.candidate.reasons] : [])
  })) : [];

  return Object.freeze({
    mode: "PAPER_ONLY",
    permissions: Object.freeze({ readOnly: true, maySubmitOrders: false, mayMutateLedger: false, mayResetRisk: false }),
    market: Object.freeze({
      state: feedState,
      quoteAgeMs,
      maxQuoteAgeMs,
      symbol: quote?.symbol ?? null,
      bid: feedState === "HEALTHY" ? quote.bid : null,
      ask: feedState === "HEALTHY" ? quote.ask : null,
      spread: feedState === "HEALTHY" ? quote.ask - quote.bid : null,
      source: quote?.source ?? null,
      selectedSymbol: feedStatus?.selectedSymbol ?? quote?.symbol ?? null,
      healthySymbolCount: Number.isSafeInteger(feedStatus?.healthyCount) ? feedStatus.healthyCount : null,
      symbolCount: Number.isSafeInteger(feedStatus?.symbolCount) ? feedStatus.symbolCount : null,
      feeds: Object.freeze(feedSymbols.map(feed => Object.freeze(feed)))
    }),
    screener: Object.freeze({
      status: screener?.status ?? "UNAVAILABLE",
      symbolCount: Number.isSafeInteger(screener?.symbolCount) ? screener.symbolCount : 0,
      candidateCount: Number.isSafeInteger(screener?.candidateCount) ? screener.candidateCount : 0,
      waitCount: Number.isSafeInteger(screener?.waitCount) ? screener.waitCount : 0,
      dataErrorCount: Number.isSafeInteger(screener?.dataErrorCount) ? screener.dataErrorCount : 0,
      results: Object.freeze(screenerResults)
    }),
    strategy: Object.freeze({
      symbol: signal?.symbol ?? null,
      side: signal?.side ?? null,
      decision: acceptanceDecision,
      signalId: signal?.clientOrderId ?? signal?.id ?? null,
      status: acceptanceDecision === "ACCEPT" ? "ELIGIBLE_FOR_PAPER" :
        acceptanceDecision === "REJECT" || acceptanceDecision === "CONDITIONAL" ? "NOT_ELIGIBLE" :
        "NOT_EVALUATED"
    }),
    portfolio: Object.freeze({
      positions: Object.freeze(normalizedPositions),
      positionCount: normalizedPositions.length,
      unmarkedPositionCount: normalizedPositions.filter(p => p.markStatus === "UNMARKED").length
    }),
    performance: Object.freeze({
      status: analyticsAvailable ? "COMPLETE" :
        ledgerComplete ? "INCOMPLETE_ANALYTICS" : "UNAVAILABLE",
      netRealizedPnl: analyticsAvailable ? performanceReport.netRealizedPnl : null,
      netRealizedReturnPct: analyticsAvailable ? performanceReport.netRealizedReturnPct : null,
      winRatePct: analyticsAvailable ? performanceReport.winRatePct : null,
      profitFactor: analyticsAvailable ? performanceReport.profitFactor : null,
      maxDrawdownPct: analyticsAvailable && performanceReport.equityMarkCount > 0
        ? performanceReport.maxDrawdownPct : null,
      closedTradeCount: analyticsAvailable ? performanceReport.closedTradeCount : null,
      totalFees: analyticsAvailable ? performanceReport.totalFees : null,
      equityMarkCount: analyticsAvailable ? performanceReport.equityMarkCount : null
    }),
    risk: Object.freeze({
      state: riskState,
      halted,
      reasons: Object.freeze(Array.isArray(riskStatus?.haltReasons)
        ? [...riskStatus.haltReasons]
        : Array.isArray(riskStatus?.reasons) ? [...riskStatus.reasons] : []),
      dailyLossPct: finite(riskStatus?.dailyLossPct) ? riskStatus.dailyLossPct : null,
      drawdownPct: finite(riskStatus?.drawdownPct) ? riskStatus.drawdownPct : null,
      exposurePct: finite(riskStatus?.exposurePct) ? riskStatus.exposurePct : null
    }),
    dataQuality: Object.freeze({
      ledger: ledgerComplete ? "COMPLETE" : "INCOMPLETE",
      equityHistory: analyticsAvailable && performanceReport.equityMarkCount > 0
        ? "AVAILABLE" : "INCOMPLETE",
      hasUnmarkedPositions: normalizedPositions.some(p => p.markStatus === "UNMARKED")
    })
  });
}
