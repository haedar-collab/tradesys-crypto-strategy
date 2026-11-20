/**
 * Deterministic execution-cost sensitivity runner for Spot backtests.
 *
 * Runs the same immutable input across a fee/slippage scenario matrix.
 * It does not estimate exchange-specific fills; scenarios are assumptions
 * supplied by the researcher and must be calibrated to their account/market.
 */
function normalizeScenarios(values, fallback, label) {
  const scenarios = values ?? fallback;
  if (!Array.isArray(scenarios) || scenarios.length === 0 ||
      scenarios.some(value => !Number.isFinite(value) || value < 0)) {
    throw new RangeError(`${label} scenarios must be a non-empty array of finite non-negative numbers`);
  }
  return [...new Set(scenarios)];
}

function summarize(result, feeBps, slippageBps) {
  if (!result || typeof result !== "object" || !Number.isFinite(result.netReturnPct) ||
      !Number.isFinite(result.endingEquity)) {
    throw new TypeError("backtest runner returned an invalid result");
  }
  const trades = Array.isArray(result.trades) ? result.trades : [];
  const totalFees = trades.reduce((sum, trade) => sum + (Number.isFinite(trade.fees) ? trade.fees : 0), 0);
  const totalGrossPnl = trades.reduce((sum, trade) => sum + (Number.isFinite(trade.grossPnl) ? trade.grossPnl : 0), 0);
  const totalNetPnl = trades.reduce((sum, trade) => sum + (Number.isFinite(trade.netPnl) ? trade.netPnl : 0), 0);
  return {
    feeBps,
    slippageBps,
    status: result.status ?? "UNKNOWN",
    tradeCount: result.tradeCount ?? trades.length,
    endingEquity: result.endingEquity,
    netPnl: result.netPnl ?? result.endingEquity - (result.initialCapital ?? 0),
    netReturnPct: result.netReturnPct,
    maxDrawdownPct: result.maxDrawdownPct ?? null,
    profitFactor: result.profitFactor ?? null,
    totalClosedTradeFees: totalFees,
    totalClosedTradeGrossPnl: totalGrossPnl,
    totalClosedTradeNetPnl: totalNetPnl,
    skippedCount: Array.isArray(result.skipped) ? result.skipped.length : 0,
    openPosition: Boolean(result.openPosition) || (Array.isArray(result.openPositions) && result.openPositions.length > 0)
  };
}

/**
 * @param {(input: object) => object} runBacktest - runEventBacktest or runPortfolioBacktest
 * @param {object} input - baseline backtest input; never mutated
 * @param {{feeBps?: number[], slippageBps?: number[]}} options
 */
export function runCostSensitivity(runBacktest, input, options = {}) {
  if (typeof runBacktest !== "function") throw new TypeError("runBacktest must be a function");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("backtest input is required");

  const feeScenarios = normalizeScenarios(options.feeBps, [0, 5, 10, 20], "feeBps");
  const slippageScenarios = normalizeScenarios(options.slippageBps, [0, 5, 10, 20, 50], "slippageBps");
  const results = [];

  for (const feeBps of feeScenarios) {
    for (const slippageBps of slippageScenarios) {
      const scenarioInput = { ...input, feeBps, slippageBps };
      const result = runBacktest(scenarioInput);
      results.push(summarize(result, feeBps, slippageBps));
    }
  }

  return {
    status: "COMPLETE",
    scenarioCount: results.length,
    feeScenariosBps: feeScenarios,
    slippageScenariosBps: slippageScenarios,
    results,
    assumptions: {
      feeBps: "per-side fee rate supplied as basis points; applied by the backtest engine",
      slippageBps: "adverse price adjustment supplied as basis points; applied by the backtest engine",
      scenarioComparison: "same market data, signals, and risk settings across every scenario",
      calibration: "researcher must replace defaults with their actual account fee tier and observed execution data"
    }
  };
}
