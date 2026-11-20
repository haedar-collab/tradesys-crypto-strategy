/**
 * Long-only SMC decision gate. This returns a research candidate, never an order.
 * All inputs must represent closed candles / confirmed upstream calculations.
 */
export function evaluateSmcSetup(input, options = {}) {
  const required = ["dailyBias", "trend4h", "price", "close4h", "atr4h", "zone", "plan"];
  if (!input || required.some(key => input[key] == null)) {
    return { status: "WAIT_DATA", candidate: false, reasons: ["MISSING_REQUIRED_CONTEXT"] };
  }
  const { dailyBias, trend4h, price, close4h, atr4h, zone, plan } = input;
  if (![price, close4h, atr4h].every(Number.isFinite) || price <= 0 || atr4h <= 0 ||
      ![zone.lo, zone.hi, plan.entry, plan.stop, plan.tp1, plan.tp2].every(Number.isFinite) ||
      zone.lo >= zone.hi || plan.entry <= plan.stop || plan.tp1 <= plan.entry || plan.tp2 <= plan.entry) {
    return { status: "WAIT_DATA", candidate: false, reasons: ["INVALID_NUMERIC_CONTEXT"] };
  }

  const reasons = [], evidence = [];
  if ((options.requireDailyBullish ?? true) && dailyBias !== "Bullish") reasons.push("DAILY_BIAS_NOT_BULLISH");
  if (trend4h === "Bearish") reasons.push("FOUR_HOUR_STRUCTURE_BEARISH");
  if (close4h < zone.lo) reasons.push("DEMAND_ZONE_INVALIDATED");
  if (input.zoneQuality?.quality === "Weak" && (options.blockWeakZones ?? true)) reasons.push("ZONE_QUALITY_WEAK");
  if (reasons.length) return { status: "WAIT", candidate: false, reasons, evidence };

  const inZone = price >= zone.lo && price <= zone.hi;
  const ltfConfirmed = input.ltf?.state === "confirmed";
  const sweepConfirmed = input.liquiditySweep?.confirmed === true;
  const rejectionConfirmed = input.rejection4h === true;
  if (input.zoneQuality?.fresh) evidence.push("FRESH_ZONE");
  if (input.zoneQuality?.quality) evidence.push(`ZONE_QUALITY_${input.zoneQuality.quality.toUpperCase()}`);
  if (input.obFvgOverlap) evidence.push("OB_FVG_CONFLUENCE");
  if (input.discount === true) evidence.push("DISCOUNT_LOCATION");
  if (ltfConfirmed) evidence.push(`LTF_${String(input.ltf.trigger || "CONFIRMED").toUpperCase().replace(/[^A-Z0-9]+/g,"_")}`);
  if (sweepConfirmed) evidence.push("LIQUIDITY_SWEEP_RECLAIM");
  if (rejectionConfirmed) evidence.push("FOUR_HOUR_BULLISH_REJECTION");

  if (!inZone && !ltfConfirmed) reasons.push("PRICE_NOT_IN_ZONE");
  if (!ltfConfirmed && !sweepConfirmed && !(inZone && rejectionConfirmed)) reasons.push("NO_CONFIRMED_ENTRY_TRIGGER");

  const risk = plan.entry - plan.stop;
  const plannedRR = (plan.tp2 - plan.entry) / risk;
  const minRR = options.minRR ?? 1.5;
  if (!Number.isFinite(minRR) || minRR <= 0) return { status:"WAIT_DATA",candidate:false,reasons:["INVALID_MIN_RR"] };
  if (plannedRR < minRR) reasons.push("PLANNED_RR_BELOW_MINIMUM");
  const fill = ltfConfirmed && !inZone ? input.ltf.close : price;
  const liveRisk = fill - plan.stop;
  const liveRR = liveRisk > 0 ? (plan.tp2 - fill) / liveRisk : 0;
  if (liveRR < minRR) reasons.push("CURRENT_RR_BELOW_MINIMUM");

  return {
    status: reasons.length ? "WAIT" : "BUY_CANDIDATE",
    candidate: reasons.length === 0,
    reasons,
    evidence,
    zone: { lo: zone.lo, hi: zone.hi, inZone },
    plan: { ...plan, plannedRR, evaluatedFill: fill, currentRR: liveRR },
    trigger: ltfConfirmed ? input.ltf.trigger || "1H_CONFIRMATION" : sweepConfirmed ? "LIQUIDITY_SWEEP" : rejectionConfirmed ? "4H_REJECTION" : null,
    disclaimer: "Research candidate only. No order execution or position sizing."
  };
}
