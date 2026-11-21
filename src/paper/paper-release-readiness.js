const REQUIRED_GATES = Object.freeze([
  "ci",
  "paperRecovery",
  "feedRecovery",
  "liveConnectivity",
  "strategyEvidenceProvenance",
  "dashboardUi",
  "operatorRunbook",
  "paperOnlySafety"
]);

/**
 * Conservative release checklist evaluator.
 * PASS requires an operator-supplied evidence reference for every gate.
 * This checks checklist completeness, not the truth or authenticity of evidence.
 */
export function evaluatePaperReleaseReadiness(evidence = {}) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new TypeError("evidence object is required");
  }

  const gates = REQUIRED_GATES.map((name) => {
    const item = evidence[name];
    const status = item?.status;
    const reference = item?.reference;
    const passed = status === "PASS" && typeof reference === "string" && reference.trim().length > 0;
    return Object.freeze({
      name,
      status: passed ? "PASS" : "BLOCKED",
      reference: passed ? reference.trim() : null,
      reason: passed ? null :
        status !== "PASS" ? "PASS status is required" : "non-empty evidence reference is required"
    });
  });

  const blocked = gates.filter((gate) => gate.status !== "PASS").map((gate) => gate.name);
  const ready = blocked.length === 0;
  return Object.freeze({
    status: ready ? "CHECKLIST_COMPLETE" : "NO_GO",
    decision: ready ? "CONTROLLED_PAPER_ONLY" : "NO_GO",
    liveTradingAuthorized: false,
    requiredGateCount: REQUIRED_GATES.length,
    passedGateCount: gates.length - blocked.length,
    blockedGates: Object.freeze(blocked),
    gates: Object.freeze(gates),
    limitations: Object.freeze([
      "Evidence references are operator-supplied and are not independently authenticated by this evaluator.",
      "A completed checklist permits controlled paper-only evaluation; it never authorizes live order execution.",
      "Strategy acceptance evaluates supplied reports and does not independently establish their data provenance."
    ])
  });
}

export { REQUIRED_GATES as PAPER_RELEASE_REQUIRED_GATES };
