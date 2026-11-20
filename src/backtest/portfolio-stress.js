import { runPortfolioBacktest } from "./portfolio.js";

function validateScenario(scenario, symbols, barCount) {
  if (!scenario || typeof scenario.name !== "string" || !scenario.name.trim() ||
      !Number.isInteger(scenario.shockIndex) || scenario.shockIndex < 1 || scenario.shockIndex >= barCount ||
      !scenario.shocks || typeof scenario.shocks !== "object" || Array.isArray(scenario.shocks)) {
    throw new TypeError("invalid portfolio stress scenario");
  }
  for (const [symbol, shockPct] of Object.entries(scenario.shocks)) {
    if (!symbols.includes(symbol)) throw new RangeError(`unknown stress symbol: ${symbol}`);
    if (!Number.isFinite(shockPct) || shockPct <= -100 || shockPct > 500) {
      throw new RangeError(`invalid shock percentage for ${symbol}`);
    }
  }
}

function shockedInput(input, scenario) {
  const assets = {};
  for (const [symbol, asset] of Object.entries(input.assets)) {
    const shockPct = scenario.shocks[symbol] ?? 0;
    const factor = 1 + shockPct / 100;
    assets[symbol] = {
      ...asset,
      bars: asset.bars.map((bar, index) => index < scenario.shockIndex ? { ...bar } : ({
        ...bar, o: bar.o * factor, h: bar.h * factor,
        l: bar.l * factor, c: bar.c * factor
      })),
      signals: asset.signals.map(signal => ({ ...signal, plan: { ...signal.plan } })),
      dailyReturns: asset.dailyReturns ? [...asset.dailyReturns] : asset.dailyReturns
    };
  }
  return { ...input, assets };
}

/**
 * Run deterministic price-shock scenarios against the aligned Spot portfolio
 * simulator. Shocks are applied to OHLC bars from shockIndex onward.
 * Signals/plans are held fixed to isolate portfolio exposure to price shocks.
 */
export function runPortfolioStress(input, scenarios, runner = runPortfolioBacktest) {
  if (!input || !input.assets || typeof input.assets !== "object" || Array.isArray(input.assets)) {
    throw new TypeError("portfolio input with assets is required");
  }
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    throw new TypeError("at least one stress scenario is required");
  }
  if (typeof runner !== "function") throw new TypeError("runner must be a function");
  const symbols = Object.keys(input.assets);
  const barCount = input.assets[symbols[0]]?.bars?.length;
  if (!Number.isInteger(barCount) || barCount < 2) throw new TypeError("assets require aligned bars");
  const names = new Set();
  const results = scenarios.map(scenario => {
    validateScenario(scenario, symbols, barCount);
    if (names.has(scenario.name)) throw new RangeError("stress scenario names must be unique");
    names.add(scenario.name);
    const result = runner(shockedInput(input, scenario));
    if (!result || !Number.isFinite(result.endingEquity) || !Number.isFinite(result.maxDrawdownPct)) {
      throw new TypeError("portfolio runner returned an invalid stress result");
    }
    return {
      name: scenario.name,
      shockIndex: scenario.shockIndex,
      shocks: { ...scenario.shocks },
      endingEquity: result.endingEquity,
      netReturnPct: result.netReturnPct,
      maxDrawdownPct: result.maxDrawdownPct,
      tradeCount: result.tradeCount,
      openPositionCount: result.openPositions?.length ?? 0,
      skippedCount: result.skipped?.length ?? 0,
      drawdownState: result.assumptions?.drawdownGuard?.state ?? "UNKNOWN"
    };
  });
  return {
    status: "COMPLETE",
    scenarioCount: results.length,
    baseline: {
      endingEquity: input.initialCapital ?? 10000,
      note: "initial capital before stress; compare with scenario ending equity"
    },
    results,
    assumptions: {
      shockModel: "multiplicative OHLC price shock from shockIndex onward",
      signals: "held fixed to isolate price-path and portfolio-risk response",
      correlation: "dailyReturns metadata is not shocked; this is a price-path stress, not a correlation-regime simulation",
      limitations: "does not model order-book liquidity, market impact, exchange outages, delistings, or cross-asset contagion"
    }
  };
}
