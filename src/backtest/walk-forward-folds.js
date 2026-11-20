/**
 * Deterministic chronological walk-forward fold planner.
 *
 * A configurable exclusion gap separates each training slice from its test
 * slice. The gap is intended to cover label/holding-period overlap (purge)
 * plus a post-test embargo when folds are used in a rolling research schedule.
 * All indices are zero-based and end-exclusive.
 */
export function createWalkForwardFolds({
  barCount, initialTrainBars, testBars, stepBars = testBars,
  purgeBars = 0, embargoBars = 0, maxFolds = Infinity,
  mode = "expanding"
} = {}) {
  for (const [name, value] of Object.entries({barCount,initialTrainBars,testBars,stepBars,purgeBars,embargoBars})) {
    if (!Number.isSafeInteger(value) || value < (["purgeBars","embargoBars"].includes(name) ? 0 : 1)) {
      throw new RangeError(`${name} has an invalid integer value`);
    }
  }
  if (!["expanding","rolling"].includes(mode)) throw new RangeError("mode must be expanding or rolling");
  if (mode === "rolling" && (!Number.isSafeInteger(arguments[0]?.rollingTrainBars) || arguments[0].rollingTrainBars < 2)) {
    throw new RangeError("rolling mode requires rollingTrainBars >= 2");
  }
  if (!(maxFolds === Infinity || (Number.isSafeInteger(maxFolds) && maxFolds > 0))) {
    throw new RangeError("maxFolds must be a positive integer or Infinity");
  }
  const rollingTrainBars = arguments[0]?.rollingTrainBars;
  const gapBars = purgeBars + embargoBars;
  const folds = [];
  let testStart = initialTrainBars + gapBars;
  while (testStart + testBars <= barCount && folds.length < maxFolds) {
    const trainEnd = testStart - gapBars;
    const trainStart = mode === "expanding" ? 0 : Math.max(0, trainEnd - rollingTrainBars);
    if (trainEnd - trainStart < 2) throw new RangeError("training window must contain at least two bars");
    const index = folds.length;
    folds.push(Object.freeze({
      name: `wf-${String(index + 1).padStart(2,"0")}`,
      trainStart, trainEnd, testStart, testEnd: testStart + testBars,
      exclusion: Object.freeze({start:trainEnd,end:testStart,purgeBars,embargoBars})
    }));
    testStart += stepBars;
  }
  if (!folds.length) throw new RangeError("not enough bars to create one walk-forward fold");
  return Object.freeze({
    status:"COMPLETE", mode, barCount, foldCount:folds.length,
    configuration:Object.freeze({initialTrainBars,testBars,stepBars,purgeBars,embargoBars,gapBars,
      rollingTrainBars:mode==="rolling"?rollingTrainBars:null}),
    folds:Object.freeze(folds)
  });
}
