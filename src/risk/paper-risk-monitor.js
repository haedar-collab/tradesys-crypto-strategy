/**
 * Paper-only portfolio risk monitor with latched kill switch.
 * Purely local: no exchange connectivity, credentials, or order execution.
 */
const positive = (v) => Number.isFinite(v) && v > 0;

export function evaluatePaperRisk(input, limits = {}) {
  const {
    equity, peakEquity, dayStartEquity, openPositions = [],
    dailyLossLimitPct = 3, maxDrawdownPct = 10, maxExposurePct = 80
  } = { ...input, ...limits };
  const reasons = [];
  if (!positive(equity) || !positive(peakEquity) || !positive(dayStartEquity) ||
      !Array.isArray(openPositions) ||
      ![dailyLossLimitPct, maxDrawdownPct, maxExposurePct].every(Number.isFinite) ||
      dailyLossLimitPct <= 0 || dailyLossLimitPct > 100 ||
      maxDrawdownPct <= 0 || maxDrawdownPct > 100 ||
      maxExposurePct <= 0 || maxExposurePct > 100) {
    return Object.freeze({ status: "WAIT_DATA", allowed: false, reasons: ["INVALID_RISK_MONITOR_INPUT"] });
  }
  if (equity > peakEquity) reasons.push("EQUITY_EXCEEDS_PEAK_EQUITY");
  let exposure = 0;
  for (const p of openPositions) {
    if (!p || !positive(p.quantity) || !positive(p.markPrice)) {
      return Object.freeze({ status: "WAIT_DATA", allowed: false, reasons: ["INVALID_POSITION_MARK"] });
    }
    exposure += p.quantity * p.markPrice;
  }
  const dailyLossPct = Math.max(0, (dayStartEquity - equity) / dayStartEquity * 100);
  const drawdownPct = Math.max(0, (peakEquity - equity) / peakEquity * 100);
  const exposurePct = exposure / equity * 100;
  if (dailyLossPct >= dailyLossLimitPct) reasons.push("DAILY_LOSS_LIMIT_REACHED");
  if (drawdownPct >= maxDrawdownPct) reasons.push("MAX_DRAWDOWN_LIMIT_REACHED");
  if (exposurePct > maxExposurePct) reasons.push("MAX_EXPOSURE_LIMIT_EXCEEDED");
  return Object.freeze({
    status: reasons.length ? "BLOCKED" : "ALLOWED",
    allowed: reasons.length === 0, reasons: Object.freeze(reasons),
    equity, exposure, exposurePct, dailyLossPct, drawdownPct,
    limits: Object.freeze({ dailyLossLimitPct, maxDrawdownPct, maxExposurePct })
  });
}

/**
 * Stateful paper-session guard. Kill switch is latched until explicit reset.
 * A reset is rejected while any hard risk threshold remains breached.
 */
export function createPaperRiskMonitor({
  dailyLossLimitPct = 3, maxDrawdownPct = 10, maxExposurePct = 80,
  now = () => Date.now(), initialState = null
} = {}) {
  const limits = { dailyLossLimitPct, maxDrawdownPct, maxExposurePct };
  if (![dailyLossLimitPct, maxDrawdownPct, maxExposurePct].every(Number.isFinite) ||
      dailyLossLimitPct <= 0 || dailyLossLimitPct > 100 ||
      maxDrawdownPct <= 0 || maxDrawdownPct > 100 ||
      maxExposurePct <= 0 || maxExposurePct > 100 || typeof now !== "function") {
    throw new RangeError("invalid paper risk monitor configuration");
  }
  if (initialState !== null && (!initialState || typeof initialState !== "object" ||
      (initialState.peakEquity !== null && !positive(initialState.peakEquity)) ||
      (initialState.dayStartEquity !== null && !positive(initialState.dayStartEquity)) ||
      typeof initialState.halted !== "boolean" ||
      !Array.isArray(initialState.haltReasons) ||
      !Array.isArray(initialState.events))) {
    throw new TypeError("initialState is invalid");
  }
  let peakEquity = initialState?.peakEquity ?? null;
  let dayStartEquity = initialState?.dayStartEquity ?? null;
  let dayKey = initialState?.dayKey ?? null;
  let halted = initialState?.halted ?? false;
  let haltReasons = [...(initialState?.haltReasons ?? [])];
  let haltAt = initialState?.haltAt ?? null;
  const events = (initialState?.events ?? []).map(e => Object.freeze(structuredClone(e)));
  const emit = (type, payload) => events.push(Object.freeze({ type, at: now(), ...structuredClone(payload) }));

  function evaluate(snapshot) {
    if (!snapshot || !positive(snapshot.equity) || !Array.isArray(snapshot.positions)) {
      return Object.freeze({ status: "WAIT_DATA", allowed: false, halted, reasons: ["INVALID_PORTFOLIO_SNAPSHOT"] });
    }
    const timestamp = snapshot.timestamp ?? now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      return Object.freeze({ status: "WAIT_DATA", allowed: false, halted, reasons: ["INVALID_TIMESTAMP"] });
    }
    const key = new Date(timestamp).toISOString().slice(0, 10);
    if (peakEquity === null) peakEquity = snapshot.equity;
    peakEquity = Math.max(peakEquity, snapshot.equity);
    if (dayKey !== key) {
      dayKey = key;
      dayStartEquity = snapshot.equity;
      emit("RISK_DAY_ROLLOVER", { dayKey, dayStartEquity });
    }
    const result = evaluatePaperRisk({
      equity: snapshot.equity, peakEquity, dayStartEquity,
      openPositions: snapshot.positions
    }, limits);
    if (!result.allowed && !halted) {
      halted = true;
      haltReasons = [...result.reasons];
      haltAt = timestamp;
      emit("KILL_SWITCH_ACTIVATED", { reasons: haltReasons, metrics: result });
    }
    return Object.freeze({ ...result, halted, allowNewEntries: result.allowed && !halted,
      haltReasons: Object.freeze([...haltReasons]), haltAt });
  }

  /**
   * Side-effect-free pre-trade check of a hypothetical (projected) portfolio.
   * It never moves peak/day baselines and never latches the kill switch, so a
   * rejected order cannot halt the session. Baselines come from the last real
   * evaluation; call evaluate() with the actual portfolio first.
   */
  function preview(snapshot) {
    if (!snapshot || !positive(snapshot.equity) || !Array.isArray(snapshot.positions)) {
      return Object.freeze({ status: "WAIT_DATA", allowed: false, halted, allowNewEntries: false, reasons: ["INVALID_PORTFOLIO_SNAPSHOT"] });
    }
    if (!positive(peakEquity) || !positive(dayStartEquity)) {
      return Object.freeze({ status: "WAIT_DATA", allowed: false, halted, allowNewEntries: false, reasons: ["RISK_BASELINE_UNAVAILABLE"] });
    }
    const result = evaluatePaperRisk({
      equity: snapshot.equity,
      peakEquity: Math.max(peakEquity, snapshot.equity),
      dayStartEquity,
      openPositions: snapshot.positions
    }, limits);
    return Object.freeze({ ...result, halted, allowNewEntries: result.allowed && !halted,
      haltReasons: Object.freeze([...haltReasons]), haltAt });
  }

  function activate(reason = "MANUAL_KILL_SWITCH") {
    if (!halted) {
      halted = true; haltReasons = [String(reason)]; haltAt = now();
      emit("KILL_SWITCH_ACTIVATED", { reasons: haltReasons, manual: true });
    }
    return status();
  }

  function reset(snapshot) {
    if (!halted) return Object.freeze({ status: "NOOP", halted: false, reasons: [] });
    if (!snapshot || !positive(snapshot.equity) || !Array.isArray(snapshot.positions)) {
      throw new TypeError("valid portfolio snapshot is required to reset kill switch");
    }
    const check = evaluatePaperRisk({
      equity: snapshot.equity,
      peakEquity: Math.max(peakEquity ?? snapshot.equity, snapshot.equity),
      dayStartEquity: dayStartEquity ?? snapshot.equity,
      openPositions: snapshot.positions
    }, limits);
    if (!check.allowed) throw new Error("cannot reset kill switch while risk limits remain breached");
    halted = false; haltReasons = []; haltAt = null;
    emit("KILL_SWITCH_RESET", { equity: snapshot.equity });
    return status();
  }

  function status() {
    return Object.freeze({ halted, haltReasons: Object.freeze([...haltReasons]), haltAt,
      peakEquity, dayStartEquity, dayKey, events: Object.freeze(events.map(e => structuredClone(e))) });
  }
  return Object.freeze({ evaluate, preview, activate, reset, status });
}
