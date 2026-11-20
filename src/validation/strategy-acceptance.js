const DEFAULT_THRESHOLDS = Object.freeze({
  minOutOfSampleTrades: 100,
  minProfitFactor: 1.2,
  maxDrawdownPct: 20,
  minPositiveFoldRatio: 0.6,
  minFoldCount: 3,
  minTradesPerRegime: 20,
  minStressedProfitFactor: 1.0,
  maxBootstrapP95DrawdownPct: 30
});

function finite(value) { return typeof value === "number" && Number.isFinite(value); }
function addMissing(list, path, value) {
  if (value === undefined || value === null) list.push(path);
}
function checkRange(name, value, min, max = Infinity) {
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`${name} must be between ${min} and ${max}`);
}

/**
 * Evidence-gated strategy decision. Missing/underpowered evidence is
 * CONDITIONAL; measured hard-threshold failures are REJECT. This module never
 * estimates metrics or executes a strategy—it evaluates supplied reports only.
 */
export function evaluateStrategyAcceptance(report, overrides = {}) {
  if (!report || typeof report !== "object" || Array.isArray(report)) throw new TypeError("report object is required");
  const thresholds = { ...DEFAULT_THRESHOLDS, ...overrides };
  checkRange("minOutOfSampleTrades", thresholds.minOutOfSampleTrades, 1);
  checkRange("minProfitFactor", thresholds.minProfitFactor, 0);
  checkRange("maxDrawdownPct", thresholds.maxDrawdownPct, 0, 100);
  checkRange("minPositiveFoldRatio", thresholds.minPositiveFoldRatio, 0, 1);
  checkRange("minFoldCount", thresholds.minFoldCount, 1);
  checkRange("minTradesPerRegime", thresholds.minTradesPerRegime, 1);
  checkRange("minStressedProfitFactor", thresholds.minStressedProfitFactor, 0);
  checkRange("maxBootstrapP95DrawdownPct", thresholds.maxBootstrapP95DrawdownPct, 0, 100);

  const missing = [], failures = [], warnings = [], checks = [];
  const pass = (name, actual, threshold, detail = "") => checks.push({name,status:"PASS",actual,threshold,detail});
  const fail = (name, actual, threshold, detail = "") => {
    failures.push(name); checks.push({name,status:"FAIL",actual,threshold,detail});
  };
  const pending = (name, detail) => {
    missing.push(name); checks.push({name,status:"PENDING",actual:null,threshold:null,detail});
  };

  if (report.dataQuality?.status === "PASS") pass("data_quality","PASS","PASS");
  else if (report.dataQuality?.status === "FAIL") fail("data_quality","FAIL","PASS");
  else pending("data_quality","A completed data-quality report is required.");

  const oos = report.outOfSample;
  if (!oos || typeof oos !== "object") {
    pending("out_of_sample");
  } else {
    for (const key of ["tradeCount","profitFactor","netReturnPct","maxDrawdownPct"]) addMissing(missing, `outOfSample.${key}`, oos[key]);
    if (["tradeCount","profitFactor","netReturnPct","maxDrawdownPct"].some(k => oos[k] == null)) {
      pending("out_of_sample_metrics","Trade count, profit factor, net return and drawdown are all required.");
    } else {
      if (!Number.isSafeInteger(oos.tradeCount) || oos.tradeCount < 0 || !finite(oos.profitFactor) ||
          !finite(oos.netReturnPct) || !finite(oos.maxDrawdownPct) || oos.maxDrawdownPct < 0) {
        fail("out_of_sample_metric_validity","INVALID","finite non-negative metrics and integer trade count");
      } else {
        if (oos.tradeCount < thresholds.minOutOfSampleTrades) fail("oos_trade_count",oos.tradeCount,thresholds.minOutOfSampleTrades);
        else pass("oos_trade_count",oos.tradeCount,thresholds.minOutOfSampleTrades);
        if (oos.profitFactor < thresholds.minProfitFactor) fail("oos_profit_factor",oos.profitFactor,thresholds.minProfitFactor);
        else pass("oos_profit_factor",oos.profitFactor,thresholds.minProfitFactor);
        if (oos.netReturnPct <= 0) fail("oos_net_return",oos.netReturnPct,"> 0");
        else pass("oos_net_return",oos.netReturnPct,"> 0");
        if (oos.maxDrawdownPct > thresholds.maxDrawdownPct) fail("oos_max_drawdown",oos.maxDrawdownPct,`<= ${thresholds.maxDrawdownPct}`);
        else pass("oos_max_drawdown",oos.maxDrawdownPct,`<= ${thresholds.maxDrawdownPct}`);
      }
    }
  }

  const folds = report.walkForward?.folds;
  if (!Array.isArray(folds) || folds.length < thresholds.minFoldCount) {
    pending("walk_forward_folds",`At least ${thresholds.minFoldCount} scored out-of-sample folds are required.`);
  } else {
    const valid = folds.every(f => f && finite(f.netReturnPct));
    if (!valid) pending("walk_forward_fold_metrics","Every fold requires a finite netReturnPct.");
    else {
      const positiveRatio = folds.filter(f => f.netReturnPct > 0).length / folds.length;
      if (positiveRatio < thresholds.minPositiveFoldRatio) fail("positive_fold_ratio",positiveRatio,thresholds.minPositiveFoldRatio);
      else pass("positive_fold_ratio",positiveRatio,thresholds.minPositiveFoldRatio);
    }
  }

  const regimes = report.regimeAnalysis?.groups;
  if (!Array.isArray(regimes) || regimes.length === 0) {
    pending("regime_analysis","Regime-level out-of-sample attribution is required.");
  } else {
    const underpowered = regimes.filter(g => !Number.isSafeInteger(g.tradeCount) || g.tradeCount < thresholds.minTradesPerRegime);
    if (underpowered.length) pending("regime_sample_size",`Each reported regime needs at least ${thresholds.minTradesPerRegime} trades; underpowered groups: ${underpowered.map(g=>g.regime ?? "unknown").join(", ")}.`);
    else {
      const losing = regimes.filter(g => !finite(g.meanNetReturnPct) || g.meanNetReturnPct <= 0);
      if (losing.length) warnings.push(`Non-positive mean return in regime(s): ${losing.map(g=>g.regime).join(", ")}`);
      pass("regime_sample_size",regimes.map(g=>({regime:g.regime,tradeCount:g.tradeCount})),`>= ${thresholds.minTradesPerRegime} per group`);
    }
  }

  const stress = report.costStress;
  if (!stress || !finite(stress.profitFactor) || !finite(stress.netReturnPct)) {
    pending("cost_slippage_stress","Worst-case defined fee/slippage scenario must report profit factor and net return.");
  } else {
    if (stress.profitFactor < thresholds.minStressedProfitFactor) fail("stressed_profit_factor",stress.profitFactor,thresholds.minStressedProfitFactor);
    else pass("stressed_profit_factor",stress.profitFactor,thresholds.minStressedProfitFactor);
    if (stress.netReturnPct <= 0) fail("stressed_net_return",stress.netReturnPct,"> 0");
    else pass("stressed_net_return",stress.netReturnPct,"> 0");
  }

  const bootstrap = report.blockBootstrap;
  if (!bootstrap || !bootstrap.maxDrawdownPct || !finite(bootstrap.maxDrawdownPct.p95)) {
    pending("block_bootstrap","Block bootstrap P95 maximum drawdown is required.");
  } else if (bootstrap.maxDrawdownPct.p95 > thresholds.maxBootstrapP95DrawdownPct) {
    fail("bootstrap_p95_drawdown",bootstrap.maxDrawdownPct.p95,`<= ${thresholds.maxBootstrapP95DrawdownPct}`);
  } else {
    pass("bootstrap_p95_drawdown",bootstrap.maxDrawdownPct.p95,`<= ${thresholds.maxBootstrapP95DrawdownPct}`);
  }

  const decision = failures.length ? "REJECT" : missing.length ? "CONDITIONAL" : "ACCEPT";
  return Object.freeze({
    status:"COMPLETE", decision, eligibleForPaperTrading:decision==="ACCEPT",
    evaluatedAt: report.evaluatedAt ?? null,
    thresholds:Object.freeze(thresholds),
    summary:Object.freeze({passed:checks.filter(c=>c.status==="PASS").length,failed:failures.length,pending:missing.length}),
    checks:Object.freeze(checks.map(Object.freeze)),
    failures:Object.freeze(failures), missingEvidence:Object.freeze(missing),
    warnings:Object.freeze(warnings),
    note:"ACCEPT means eligible for controlled paper-trading evaluation only. It is not authorization for live trading and does not guarantee future performance."
  });
}

export { DEFAULT_THRESHOLDS as STRATEGY_ACCEPTANCE_DEFAULT_THRESHOLDS };
