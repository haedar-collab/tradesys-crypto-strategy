/**
 * Adapters that bind research validators to the actual event-driven and
 * portfolio Spot simulators. This keeps the research harness honest about
 * the execution engine used to produce its metrics.
 */
import { runEventBacktest } from "./event-driven.js";
import { runPortfolioBacktest } from "./portfolio.js";
import { runParameterSensitivity } from "./parameter-sensitivity.js";
import { runWalkForward } from "./walk-forward.js";
import { runUntouchedHoldout } from "./untouched-holdout.js";

export function createEventBacktestRunner() {
  return input => runEventBacktest(input);
}
export function createPortfolioBacktestRunner() {
  return input => runPortfolioBacktest(input);
}
export function evaluateEventParameterSensitivity(input, parameterSets, options = {}) {
  return runParameterSensitivity(createEventBacktestRunner(), input, parameterSets, options);
}
export function evaluatePortfolioParameterSensitivity(input, parameterSets, options = {}) {
  return runParameterSensitivity(createPortfolioBacktestRunner(), input, parameterSets, options);
}
export function evaluateEventWalkForward(input, options = {}) {
  return runWalkForward(input, { ...options, runner: createEventBacktestRunner() });
}
export function evaluatePortfolioWalkForward(input, options = {}) {
  return runWalkForward(input, { ...options, runner: createPortfolioBacktestRunner() });
}
export function evaluateEventUntouchedHoldout(input, options = {}) {
  return runUntouchedHoldout(input, { ...options, runner: createEventBacktestRunner() });
}
export function evaluatePortfolioUntouchedHoldout(input, options = {}) {
  return runUntouchedHoldout(input, { ...options, runner: createPortfolioBacktestRunner() });
}
