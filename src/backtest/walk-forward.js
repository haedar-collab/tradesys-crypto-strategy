/**
 * Chronological walk-forward evaluation for single-symbol or multi-symbol Spot inputs.
 * Window bounds are zero-based bar indices with an exclusive end.
 * Candidate parameters are selected using training data only; test data is
 * evaluated once with the selected candidate.
 */
function validateBarsInput(input) {
  if (Array.isArray(input?.bars)) return { kind: "single", bars: input.bars };
  if (input?.assets && typeof input.assets === "object" && !Array.isArray(input.assets)) {
    const symbols = Object.keys(input.assets);
    if (!symbols.length) throw new TypeError("portfolio input has no assets");
    const bars = input.assets[symbols[0]]?.bars;
    if (!Array.isArray(bars)) throw new TypeError("portfolio assets require bars");
    for (const symbol of symbols) {
      const assetBars = input.assets[symbol]?.bars;
      if (!Array.isArray(assetBars) || assetBars.length !== bars.length ||
          assetBars.some((bar, i) => bar?.t !== bars[i]?.t)) {
        throw new RangeError("walk-forward portfolio assets must have aligned bars");
      }
    }
    return { kind: "portfolio", bars };
  }
  throw new TypeError("single-symbol bars or portfolio assets are required");
}

function sliceSignals(signals, start, end) {
  if (!Array.isArray(signals)) throw new TypeError("signals must be an array");
  return signals.filter(s => Number.isInteger(s.index) && s.index >= start && s.index < end - 1)
    .map(s => ({ ...s, index: s.index - start, plan: s.plan ? { ...s.plan } : s.plan }));
}

function sliceWindow(input, kind, start, end, parameters) {
  if (kind === "single") {
    return { ...input, ...parameters, bars: input.bars.slice(start, end),
      signals: sliceSignals(input.signals, start, end) };
  }
  const assets = {};
  for (const [symbol, asset] of Object.entries(input.assets)) {
    assets[symbol] = { ...asset, bars: asset.bars.slice(start, end),
      signals: sliceSignals(asset.signals, start, end),
      dailyReturns: Array.isArray(asset.dailyReturns) ? [...asset.dailyReturns] : asset.dailyReturns };
  }
  return { ...input, ...parameters, assets };
}

function metricValue(result, metric) {
  const value = result?.[metric];
  if (!Number.isFinite(value)) throw new TypeError(`backtest result missing finite metric: ${metric}`);
  return value;
}

export function runWalkForward(input, options = {}) {
  const runner = options.runner;
  if (typeof runner !== "function") throw new TypeError("runner function is required");
  const candidates = options.parameterCandidates;
  const windows = options.windows;
  const metric = options.selectionMetric ?? "netReturnPct";
  if (!Array.isArray(candidates) || !candidates.length ||
      candidates.some(p => !p || typeof p !== "object" || Array.isArray(p))) {
    throw new TypeError("non-empty parameterCandidates array is required");
  }
  if (!Array.isArray(windows) || !windows.length) throw new TypeError("non-empty windows array is required");
  const { kind, bars } = validateBarsInput(input);
  const names = new Set();
  const results = windows.map((window, windowIndex) => {
    if (!window || typeof window.name !== "string" || !window.name.trim() ||
        names.has(window.name)) throw new TypeError("each walk-forward window needs a unique name");
    names.add(window.name);
    const { trainStart, trainEnd, testStart, testEnd } = window;
    if (![trainStart, trainEnd, testStart, testEnd].every(Number.isInteger) ||
        trainStart < 0 || trainEnd <= trainStart + 1 || testStart < trainEnd ||
        testEnd <= testStart + 1 || testEnd > bars.length) {
      throw new RangeError("invalid chronological walk-forward window bounds");
    }
    const training = candidates.map((parameters, candidateIndex) => {
      const sample = sliceWindow(input, kind, trainStart, trainEnd, parameters);
      const result = runner(sample);
      return { candidateIndex, parameters: { ...parameters }, metricValue: metricValue(result, metric),
        netReturnPct: result.netReturnPct, maxDrawdownPct: result.maxDrawdownPct ?? null,
        tradeCount: result.tradeCount ?? 0 };
    });
    training.sort((a,b) => b.metricValue - a.metricValue || a.candidateIndex - b.candidateIndex);
    const selected = training[0];
    const testInput = sliceWindow(input, kind, testStart, testEnd, candidates[selected.candidateIndex]);
    const test = runner(testInput);
    metricValue(test, metric);
    return {
      name: window.name, train: { start: trainStart, endExclusive: trainEnd },
      test: { start: testStart, endExclusive: testEnd },
      selectedParameters: selected.parameters,
      selectedTrainingMetric: selected.metricValue,
      trainingCandidates: training,
      outOfSample: { netReturnPct: test.netReturnPct, maxDrawdownPct: test.maxDrawdownPct ?? null,
        tradeCount: test.tradeCount ?? 0, endingEquity: test.endingEquity ?? null,
        selectionMetricValue: metricValue(test, metric) }
    };
  });
  return {
    status: "COMPLETE", windowCount: results.length,
    selectionMetric: metric, results,
    assumptions: {
      chronology: "candidate selection uses training slice only; selected candidate is then evaluated on the later test slice",
      boundaries: "zero-based bar indices with exclusive end; no overlap is permitted between each window's train and test slices",
      signals: "signals are sliced and re-indexed from supplied input; this runner does not regenerate strategy signals or optimize signal-generation parameters",
      candidateSelection: "highest training metric wins; ties use original candidate order",
      limitations: "walk-forward results remain dependent on supplied precomputed signals, candidate definitions, data quality, and execution assumptions"
    }
  };
}
