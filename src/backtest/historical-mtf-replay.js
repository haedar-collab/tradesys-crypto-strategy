/**
 * Deterministic historical replay over normalized Binance Spot klines.
 * Market-data acquisition belongs to the application/data adapter; this module
 * consumes supplied historical rows and emits research decisions only.
 */
import { evaluateCausalMultiTimeframeSetup } from "../engine/causal-mtf.js";

const TIMEFRAMES = ["weekly", "daily", "h4", "h1"];

function validateReplayInput(input, evaluationTimes) {
  if (!input || typeof input !== "object") throw new TypeError("historical timeframe input is required");
  for (const timeframe of TIMEFRAMES) {
    if (!Array.isArray(input[timeframe])) throw new TypeError(`${timeframe} candles must be an array`);
  }
  if (!Array.isArray(evaluationTimes) || evaluationTimes.length === 0) {
    throw new TypeError("evaluationTimes must be a non-empty array of UTC millisecond timestamps");
  }
  let previous = -Infinity;
  for (const [index, timestamp] of evaluationTimes.entries()) {
    if (!Number.isFinite(timestamp) || timestamp <= previous) {
      throw new RangeError(`evaluationTimes[${index}] must be finite and strictly increasing`);
    }
    previous = timestamp;
  }
}

/**
 * Evaluate a supplied historical timeline without fetching data or placing orders.
 * Each evaluation rebuilds its MTF context using only candles closed strictly
 * before that evaluation timestamp.
 */
export function runHistoricalMtfReplay(input, evaluationTimes, options = {}) {
  validateReplayInput(input, evaluationTimes);
  const decisions = [];
  for (const evaluationTime of evaluationTimes) {
    const decision = evaluateCausalMultiTimeframeSetup(input, {
      ...options,
      evaluationTime,
      requireAsOfValidation: true
    });
    decisions.push(Object.freeze({
      evaluationTime,
      status: decision.status ?? "WAIT",
      candidate: decision.candidate === true,
      reasons: Array.isArray(decision.reasons) ? decision.reasons : [],
      decision
    }));
  }
  const ready = decisions.filter(item => item.status === "READY").length;
  const candidates = decisions.filter(item => item.candidate).length;
  return {
    status: "COMPLETE",
    mode: "historical-research-only",
    timeframeCount: TIMEFRAMES.length,
    evaluationCount: decisions.length,
    readyCount: ready,
    candidateCount: candidates,
    decisions,
    assumptions: {
      dataSource: "caller-supplied normalized Binance Spot klines; no network access",
      informationSet: "only candles with closeTime strictly less than evaluationTime",
      execution: "no order execution or fill simulation is performed by this replay driver",
      nextStep: "pass emitted chronological decisions to a separately configured event-driven backtest"
    }
  };
}
