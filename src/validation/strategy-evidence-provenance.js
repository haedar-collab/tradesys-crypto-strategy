import { createHash } from "node:crypto";
import { evaluateStrategyAcceptance } from "./strategy-acceptance.js";

const REQUIRED_ROLES = Object.freeze([
  "dataset",
  "strategy_source",
  "parameters",
  "experiment_report",
  "evaluator_source"
]);
const SHA256 = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40,64}$/;

function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  if (value && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonicalize(value[key])).join(",") + "}";
  }
  throw new TypeError("evidence report must contain only JSON-compatible values");
}
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function finding(code, detail) { return Object.freeze({ code, detail }); }

/**
 * Verifies that an acceptance report is bound to immutable, content-addressed
 * experiment inputs. Artifact bytes must be supplied by the caller; references
 * and hashes are not fetched or authenticated against a remote host here.
 */
export function verifyStrategyEvidenceProvenance({ report, manifest, artifacts } = {}) {
  const findings = [];
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new TypeError("report object is required");
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return Object.freeze({ status: "FAIL", verified: false, findings: Object.freeze([finding("MANIFEST_MISSING", "A provenance manifest is required.")]), verifiedRoles: Object.freeze([]) });
  }
  if (manifest.schemaVersion !== 1) findings.push(finding("SCHEMA_VERSION_UNSUPPORTED", "schemaVersion must equal 1."));
  if (typeof manifest.runId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(manifest.runId)) findings.push(finding("RUN_ID_INVALID", "A stable runId is required."));
  if (typeof manifest.createdAt !== "string" || !Number.isFinite(Date.parse(manifest.createdAt)) || !manifest.createdAt.endsWith("Z")) {
    findings.push(finding("CREATED_AT_INVALID", "createdAt must be a valid UTC ISO timestamp ending in Z."));
  }
  if (!manifest.strategy || typeof manifest.strategy.id !== "string" || !manifest.strategy.id.trim() ||
      typeof manifest.strategy.revision !== "string" || !REVISION.test(manifest.strategy.revision)) {
    findings.push(finding("STRATEGY_IDENTITY_INVALID", "Strategy id and immutable 40-64 character revision are required."));
  }
  if (!manifest.dataset || typeof manifest.dataset.id !== "string" || !manifest.dataset.id.trim() ||
      typeof manifest.dataset.revision !== "string" || !SHA256.test(manifest.dataset.revision)) {
    findings.push(finding("DATASET_IDENTITY_INVALID", "Dataset id and SHA-256 content revision are required."));
  }
  if (!Array.isArray(manifest.artifacts)) {
    findings.push(finding("ARTIFACT_LIST_INVALID", "artifacts must be an array."));
  }

  const entries = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  const roles = new Map();
  const paths = new Set();
  for (const item of entries) {
    if (!item || typeof item !== "object" || typeof item.role !== "string" ||
        typeof item.path !== "string" || !item.path || item.path.startsWith("/") ||
        item.path.split("/").includes("..") || typeof item.sha256 !== "string" || !SHA256.test(item.sha256)) {
      findings.push(finding("ARTIFACT_DESCRIPTOR_INVALID", "Each artifact needs a role, safe relative path, and lowercase SHA-256."));
      continue;
    }
    if (roles.has(item.role)) findings.push(finding("ARTIFACT_ROLE_DUPLICATE", "Duplicate artifact role: " + item.role));
    if (paths.has(item.path)) findings.push(finding("ARTIFACT_PATH_DUPLICATE", "Duplicate artifact path: " + item.path));
    roles.set(item.role, item);
    paths.add(item.path);
  }

  const verifiedRoles = [];
  for (const role of REQUIRED_ROLES) {
    const item = roles.get(role);
    if (!item) {
      findings.push(finding("ARTIFACT_ROLE_MISSING", "Required artifact is missing: " + role));
      continue;
    }
    const content = artifacts && Object.hasOwn(artifacts, item.path) ? artifacts[item.path] : undefined;
    if (!(typeof content === "string" || content instanceof Uint8Array)) {
      findings.push(finding("ARTIFACT_CONTENT_MISSING", "Artifact bytes are missing for: " + item.path));
      continue;
    }
    const actual = digest(content);
    if (actual !== item.sha256) {
      findings.push(finding("ARTIFACT_HASH_MISMATCH", "Content hash mismatch for: " + item.path));
      continue;
    }
    verifiedRoles.push(role);
    if (role === "dataset" && actual !== manifest.dataset?.revision) {
      findings.push(finding("DATASET_REVISION_MISMATCH", "Dataset revision does not match dataset artifact bytes."));
    }
    if (role === "experiment_report") {
      let reportBytes;
      try { reportBytes = canonicalize(report); }
      catch (error) { findings.push(finding("REPORT_NOT_CANONICAL_JSON", error.message)); continue; }
      if (digest(reportBytes) !== actual) {
        findings.push(finding("REPORT_CONTENT_MISMATCH", "Supplied acceptance report differs from the hashed experiment_report artifact."));
      }
    }
  }

  return Object.freeze({
    status: findings.length ? "FAIL" : "PASS",
    verified: findings.length === 0,
    runId: manifest.runId ?? null,
    strategyId: manifest.strategy?.id ?? null,
    datasetId: manifest.dataset?.id ?? null,
    verifiedRoles: Object.freeze(verifiedRoles.sort()),
    findings: Object.freeze(findings)
  });
}

/**
 * Provenance-gated wrapper. A metric-level ACCEPT without verified provenance
 * is downgraded to CONDITIONAL and can never become paper-trading eligible.
 */
export function evaluateStrategyAcceptanceWithProvenance(report, provenance, overrides = {}) {
  const acceptance = evaluateStrategyAcceptance(report, overrides);
  const verification = verifyStrategyEvidenceProvenance({
    report,
    manifest: provenance?.manifest,
    artifacts: provenance?.artifacts
  });
  const decision = acceptance.decision === "REJECT" ? "REJECT" :
    !verification.verified ? "CONDITIONAL" : acceptance.decision;
  return Object.freeze({
    ...acceptance,
    decision,
    eligibleForPaperTrading: decision === "ACCEPT",
    provenance: verification,
    missingEvidence: Object.freeze([
      ...acceptance.missingEvidence,
      ...(!verification.verified ? ["strategy_evidence_provenance"] : [])
    ]),
    note: "ACCEPT requires both metric gates and content-verified experiment provenance; eligibility remains controlled paper-only and never authorizes live trading."
  });
}

export { REQUIRED_ROLES as STRATEGY_EVIDENCE_REQUIRED_ARTIFACT_ROLES };
