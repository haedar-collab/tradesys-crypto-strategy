import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePaperReleaseReadiness,
  PAPER_RELEASE_REQUIRED_GATES
} from "../src/paper/paper-release-readiness.js";

const completeEvidence = Object.fromEntries(
  PAPER_RELEASE_REQUIRED_GATES.map(name => [name, {
    status: "PASS", reference: "reviewed-evidence:" + name
  }])
);

test("release readiness is NO_GO when evidence is absent", () => {
  const result = evaluatePaperReleaseReadiness();
  assert.equal(result.status, "NO_GO");
  assert.equal(result.decision, "NO_GO");
  assert.equal(result.liveTradingAuthorized, false);
  assert.equal(result.passedGateCount, 0);
  assert.deepEqual(result.blockedGates, [...PAPER_RELEASE_REQUIRED_GATES]);
});

test("missing live connectivity and strategy provenance block readiness", () => {
  const evidence = { ...completeEvidence };
  delete evidence.liveConnectivity;
  evidence.strategyEvidenceProvenance = { status: "PENDING", reference: "not-verified" };
  const result = evaluatePaperReleaseReadiness(evidence);
  assert.equal(result.decision, "NO_GO");
  assert.deepEqual(result.blockedGates, ["liveConnectivity", "strategyEvidenceProvenance"]);
});

test("PASS without a concrete evidence reference is blocked", () => {
  const evidence = {
    ...completeEvidence,
    dashboardUi: { status: "PASS", reference: "   " }
  };
  const result = evaluatePaperReleaseReadiness(evidence);
  assert.ok(result.blockedGates.includes("dashboardUi"));
});

test("complete reviewed checklist permits controlled paper only, never live trading", () => {
  const result = evaluatePaperReleaseReadiness(completeEvidence);
  assert.equal(result.status, "CHECKLIST_COMPLETE");
  assert.equal(result.decision, "CONTROLLED_PAPER_ONLY");
  assert.equal(result.passedGateCount, PAPER_RELEASE_REQUIRED_GATES.length);
  assert.equal(result.liveTradingAuthorized, false);
  assert.ok(result.limitations.some(x => x.includes("not independently authenticated")));
});

test("invalid evidence container is rejected", () => {
  assert.throws(() => evaluatePaperReleaseReadiness(null), /evidence object/);
  assert.throws(() => evaluatePaperReleaseReadiness([]), /evidence object/);
});
