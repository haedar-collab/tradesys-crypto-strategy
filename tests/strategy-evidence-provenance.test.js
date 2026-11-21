import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  verifyStrategyEvidenceProvenance,
  evaluateStrategyAcceptanceWithProvenance
} from "../src/validation/strategy-evidence-provenance.js";

const hash = value => createHash("sha256").update(value).digest("hex");
const canonical = value => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
};
const report = () => ({
  dataQuality:{status:"PASS"},
  outOfSample:{tradeCount:180,profitFactor:1.55,netReturnPct:18,maxDrawdownPct:12},
  walkForward:{folds:[{netReturnPct:4},{netReturnPct:2},{netReturnPct:-1},{netReturnPct:3},{netReturnPct:1}]},
  regimeAnalysis:{groups:[
    {regime:"BULLISH_NORMAL",tradeCount:65,meanNetReturnPct:0.8},
    {regime:"BEARISH_NORMAL",tradeCount:55,meanNetReturnPct:0.4},
    {regime:"SIDEWAYS_NORMAL",tradeCount:60,meanNetReturnPct:0.2}
  ]},
  costStress:{profitFactor:1.12,netReturnPct:4},
  blockBootstrap:{maxDrawdownPct:{p95:22}},
  evaluatedAt:"2026-11-20T00:00:00.000Z"
});
function bundle(input = report()) {
  const contents = {
    "data/btcusdt-1h.csv":"timestamp,open,high,low,close,volume\n1,1,2,1,2,10\n",
    "src/strategy.js":"export const strategyVersion = 7;\n",
    "config/parameters.json":"{\"riskPct\":0.5,\"lookback\":20}\n",
    "runs/report.json":canonical(input),
    "src/evaluator.js":"export const evaluatorVersion = 1;\n"
  };
  const manifest = {
    schemaVersion:1,runId:"run_20261121_001",createdAt:"2026-11-21T04:00:00.000Z",
    strategy:{id:"tradesys-smc-v1",revision:"a".repeat(40)},
    dataset:{id:"binance-btcusdt-1h",revision:hash(contents["data/btcusdt-1h.csv"])},
    artifacts:[
      {role:"dataset",path:"data/btcusdt-1h.csv",sha256:hash(contents["data/btcusdt-1h.csv"])},
      {role:"strategy_source",path:"src/strategy.js",sha256:hash(contents["src/strategy.js"])},
      {role:"parameters",path:"config/parameters.json",sha256:hash(contents["config/parameters.json"])},
      {role:"experiment_report",path:"runs/report.json",sha256:hash(contents["runs/report.json"])},
      {role:"evaluator_source",path:"src/evaluator.js",sha256:hash(contents["src/evaluator.js"])}
    ]
  };
  return {manifest,artifacts:contents};
}

test("verifies all required immutable artifacts and exact report content",()=>{
  const input=report(), proof=bundle(input);
  const result=verifyStrategyEvidenceProvenance({report:input,...proof});
  assert.equal(result.status,"PASS");
  assert.deepEqual(result.verifiedRoles,["dataset","evaluator_source","experiment_report","parameters","strategy_source"]);
});

test("missing manifest or artifacts fails closed",()=>{
  assert.equal(verifyStrategyEvidenceProvenance({report:report()}).status,"FAIL");
  const proof=bundle();
  delete proof.artifacts["src/strategy.js"];
  assert.ok(verifyStrategyEvidenceProvenance({report:report(),...proof}).findings.some(x=>x.code==="ARTIFACT_CONTENT_MISSING"));
});

test("modified artifact bytes are detected",()=>{
  const proof=bundle();
  proof.artifacts["src/strategy.js"] += "// changed";
  const result=verifyStrategyEvidenceProvenance({report:report(),...proof});
  assert.ok(result.findings.some(x=>x.code==="ARTIFACT_HASH_MISMATCH"));
});

test("report cannot be swapped while reusing a valid manifest",()=>{
  const proof=bundle();
  const changed=report(); changed.outOfSample.profitFactor=2.8;
  const result=verifyStrategyEvidenceProvenance({report:changed,...proof});
  assert.ok(result.findings.some(x=>x.code==="REPORT_CONTENT_MISMATCH"));
});

test("duplicate roles, unsafe paths, and dataset revision mismatch are rejected",()=>{
  const proof=bundle();
  proof.manifest.artifacts.push({...proof.manifest.artifacts[0],path:"../escape.csv"});
  proof.manifest.dataset.revision="b".repeat(64);
  const result=verifyStrategyEvidenceProvenance({report:report(),...proof});
  assert.ok(result.findings.some(x=>x.code==="ARTIFACT_DESCRIPTOR_INVALID"));
  assert.ok(result.findings.some(x=>x.code==="DATASET_REVISION_MISMATCH"));
});

test("metric ACCEPT is downgraded when provenance is missing or invalid",()=>{
  const input=report();
  const result=evaluateStrategyAcceptanceWithProvenance(input, {manifest:bundle().manifest,artifacts:{}});
  assert.equal(result.decision,"CONDITIONAL");
  assert.equal(result.eligibleForPaperTrading,false);
  assert.equal(result.provenance.status,"FAIL");
});

test("complete metrics and verified provenance permits paper-only eligibility",()=>{
  const input=report(), proof=bundle(input);
  const result=evaluateStrategyAcceptanceWithProvenance(input,proof);
  assert.equal(result.decision,"ACCEPT");
  assert.equal(result.eligibleForPaperTrading,true);
});

test("hard metric rejection remains REJECT even when provenance is invalid",()=>{
  const input=report(); input.outOfSample.profitFactor=0.1;
  const result=evaluateStrategyAcceptanceWithProvenance(input,{});
  assert.equal(result.decision,"REJECT");
});
