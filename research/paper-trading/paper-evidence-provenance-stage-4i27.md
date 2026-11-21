# Stage 4I.27 — Strategy Evidence Provenance Verification

## Objective
Prevent a metric-only strategy acceptance report from becoming paper-trading eligible unless the supplied experiment artifacts are content-addressed and match the report being evaluated.

## Implementation
- `src/validation/strategy-evidence-provenance.js`
- `verifyStrategyEvidenceProvenance({ report, manifest, artifacts })` verifies a versioned manifest, UTC run timestamp, strategy identity/revision, dataset identity/SHA-256, and five required artifacts.
- Required artifact roles: dataset, strategy source, parameters, experiment report, evaluator source.
- Every artifact is verified from supplied bytes against its SHA-256. The report is canonicalized as JSON and must exactly match the hashed experiment-report artifact.
- `evaluateStrategyAcceptanceWithProvenance(...)` wraps the existing metric gate. A metric-level ACCEPT without verified provenance is downgraded to CONDITIONAL. A hard metric failure remains REJECT.
- Existing `evaluateStrategyAcceptance` remains backward compatible.

## Security boundary and limitations
- This verifies content consistency, not who created the artifacts. A caller can still fabricate a complete manifest and matching bytes.
- Git revision format is validated but the commit is not fetched or authenticated against GitHub.
- Artifacts are passed in memory; no remote storage, signing key, trusted timestamp, or immutable object store is introduced.
- Dataset revision must equal the SHA-256 of the supplied dataset bytes.
- A PASS permits paper-only eligibility under the existing acceptance policy; it never authorizes live trading.
- This stage does not resolve the full 4I.26 release NO-GO. Binance live connectivity, rendered dashboard UI, and operator runbook approval remain outstanding.

## Tests
- Missing manifest/artifact, hash mismatch, report substitution, duplicate role, unsafe path, dataset revision mismatch.
- Metric ACCEPT is downgraded when provenance fails; hard REJECT remains REJECT.
- Full validation is performed by the repository CI workflow.
