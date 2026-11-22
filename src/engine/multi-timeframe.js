/**
 * Conservative multi-timeframe orchestration for long-only Binance Spot.
 * Inputs are pre-fetched, normalized, closed-candle contexts. No I/O or orders.
 *
 * Policy: unconfirmed benchmark regime and provisional weekly context block
 * fresh entries. Weekly/Daily bias must not contradict the 4H demand setup.
 */
import { evaluateLtfTrigger } from "../structure/ltf-trigger.js";
import { selectDemandZone } from "../structure/select-zone.js";
import { evaluateSmcSetup } from "../structure/decision.js";
import { buildLongPlan } from "../risk/trade-plan.js";
import { validateMultiTimeframeAsOf } from "../validation/timeframes.js";

export const STRATEGY_ENGINE_VERSION = "0.2.0";

const wait = (reason, details = {}) => ({
  status: "WAIT",
  candidate: false,
  reasons: [reason],
  ...details,
  strategyVersion: STRATEGY_ENGINE_VERSION
});

export function evaluateMultiTimeframeSetup(input, options = {}) {
  if (!input || !input.weekly || !input.daily || !input.regime || !input.h4) {
    return wait("MISSING_TIMEFRAME_CONTEXT");
  }
  if (options.requireAsOfValidation === true) {
    const temporal = validateMultiTimeframeAsOf(input, { evaluationTime: options.evaluationTime, maxAgeMs: options.maxAgeMs });
    if (temporal.status !== "PASS") return wait("TIMEFRAME_ASOF_VALIDATION_FAILED", { temporal });
  }
  const { weekly, daily, regime, h4 } = input;
  if (weekly.closed !== true) return wait("WEEKLY_CONTEXT_PROVISIONAL");
  if (!["Bullish","Neutral","Sideways","Mixed","Bearish"].includes(weekly.trend)) return wait("INVALID_WEEKLY_BIAS");
  if (weekly.trend === "Bearish") return wait("WEEKLY_BIAS_BEARISH");
  if (daily.bias !== "Bullish") return wait("DAILY_BIAS_NOT_BULLISH");
  // Research option (default true): with requireConfirmedRegime === false an
  // unconfirmed regime is allowed, but a raw Downtrend still blocks entries.
  if (options.requireConfirmedRegime !== false && regime.confirmed !== true) return wait("MARKET_REGIME_UNCONFIRMED", { regime });
  if (options.requireConfirmedRegime === false && regime.raw === "Downtrend") return wait("MARKET_REGIME_DOWNTREND", { regime });
  if (!["Uptrend","Sideways","Kompresi","Kapitulasi","Downtrend"].includes(regime.effective)) return wait("INVALID_MARKET_REGIME", { regime });
  if (regime.effective === "Downtrend") return wait("MARKET_REGIME_DOWNTREND", { regime });
  if (!h4.series || !Number.isFinite(h4.price) || h4.price <= 0 || !Number.isFinite(h4.close) || h4.close <= 0 ||
      !Number.isFinite(h4.atr) || h4.atr <= 0 || !["Bullish","Neutral","Sideways","Mixed","Bearish"].includes(h4.trend) ||
      !Number.isFinite(h4.rangeEquilibrium) || h4.rangeEquilibrium <= 0) {
    return wait("INVALID_4H_CONTEXT");
  }

  const selection = selectDemandZone({
    price: h4.price,
    atr: h4.atr,
    rangeEquilibrium: h4.rangeEquilibrium,
    orderBlocks: h4.orderBlocks || [],
    fvgs: h4.fvgs || [],
    series: h4.series,
    maxAtrDistance: options.maxAtrDistance ?? 4
  });
  if (!selection.selected) return wait("NO_VALID_DEMAND_ZONE", { candidates: selection.candidates });

  const zone = selection.selected;
  const plan = buildLongPlan({
    zone,
    atr: h4.atr,
    price: h4.price,
    targetLevels: h4.targetLevels || []
  }, options.plan || {});
  if (plan.status !== "READY") {
    return wait(plan.reasons?.[0] || "TRADE_PLAN_NOT_READY", { zone, plan, candidates: selection.candidates });
  }

  const ltf = input.h1?.series
    ? evaluateLtfTrigger(input.h1.series, zone, h4.atr)
    : null;
  if (!ltf) return wait("1H_TRIGGER_DATA_UNAVAILABLE", { zone, plan });
  if (ltf.state === "broken") return wait("1H_DEMAND_ZONE_BROKEN", { zone, plan, ltf });
  const decision = evaluateSmcSetup({
    dailyBias: daily.bias,
    trend4h: h4.trend,
    price: h4.price,
    close4h: h4.close,
    atr4h: h4.atr,
    zone,
    zoneQuality: zone.quality,
    obFvgOverlap: zone.overlap === true,
    discount: h4.rangeEquilibrium != null && zone.hi <= h4.rangeEquilibrium * 1.01,
    liquiditySweep: h4.liquiditySweep,
    rejection4h: h4.rejection === true,
    ltf,
    plan
  }, {
    minRR: options.minRR ?? 1.5,
    maxLtfChaseAtr: options.maxLtfChaseAtr ?? 0.6,
    requireDailyBullish: true,
    blockWeakZones: options.blockWeakZones ?? true
  });

  return {
    ...decision,
    regime: { raw: regime.raw, effective: regime.effective, confirmed: regime.confirmed },
    timeframeEvidence: {
      weekly: weekly.trend,
      daily: daily.bias,
      regime: regime.effective,
      structure4h: h4.trend,
      zone: { kind: zone.kind, quality: zone.quality?.quality, lo: zone.lo, hi: zone.hi },
      trigger1h: ltf.trigger || ltf.state
    },
    candidates: selection.candidates.map(item => ({
      lo: item.lo, hi: item.hi, idx: item.idx, kind: item.kind,
      quality: item.quality?.quality, overlap: item.overlap
    })),
    strategyVersion: STRATEGY_ENGINE_VERSION,
    disclaimer: "Research candidate only. No order execution, account access, or profitability guarantee."
  };
}
