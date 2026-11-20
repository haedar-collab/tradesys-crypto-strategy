import test from "node:test";
import assert from "node:assert/strict";
import { auditPaperRecovery } from "../src/paper/paper-recovery-audit.js";

const order = (id, side = "BUY", quantity = 1) => ({
  clientOrderId: id, symbol: "BTCUSDT", side, quantity, gross: 100,
  fee: 1, fillPrice: 100, status: "FILLED"
});
function fixture({ events = null, orders = [order("client_0001")], cash = 9_899,
  positions = [{ symbol: "BTCUSDT", quantity: 1 }] } = {}) {
  const rows = [{ eventId: "session_start_001", type: "SESSION_STARTED", payload: { config: { mode: "PAPER_ONLY" } } }, ...(events ?? [
    { eventId: "submit_0001", type: "ORDER_SUBMITTED", payload: { clientOrderId: "client_0001" } },
    { eventId: "fill_0001", type: "ORDER_FILLED", payload: { clientOrderId: "client_0001", order: order("client_0001") } },
    { eventId: "risk_0001", type: "RISK_EVENT", payload: { state: { halted: false } } }
  ])];
  return {
    ledgerSnapshot: { status: "COMPLETE", eventCount: rows.length, lastSequence: rows.length,
      lastHash: "a".repeat(64), events: rows.map((e, i) => ({ sequence: i + 1, ...e })) },
    brokerSnapshot: { orders, cash, positions },
    initialCash: 10_000
  };
}

test("clean ledger and broker reconcile with PASS", () => {
  const report = auditPaperRecovery(fixture());
  assert.equal(report.status, "PASS");
  assert.equal(report.summary.critical, 0);
  assert.equal(report.findings.length, 0);
});

test("unverified or incomplete ledger snapshot fails closed", () => {
  const input = fixture();
  input.ledgerSnapshot.status = "INCOMPLETE";
  const report = auditPaperRecovery(input);
  assert.equal(report.status, "FAIL");
  assert.equal(report.findings[0].code, "LEDGER_SNAPSHOT_UNVERIFIED");
});

test("unresolved order intent is reported for manual review, never auto-replayed", () => {
  const input = fixture({ events: [
    { eventId: "submit_0001", type: "ORDER_SUBMITTED", payload: { clientOrderId: "client_0001" } },
    { eventId: "risk_0001", type: "RISK_EVENT", payload: { state: { halted: false } } }
  ], orders: [], cash: 10_000, positions: [] });
  const report = auditPaperRecovery(input);
  assert.equal(report.status, "REVIEW");
  assert.ok(report.findings.some(x => x.code === "AMBIGUOUS_ORDER_INTENT"));
});

test("ledger fill absent from broker is critical", () => {
  const input = fixture({ orders: [], cash: 10_000, positions: [] });
  const report = auditPaperRecovery(input);
  assert.equal(report.status, "FAIL");
  assert.ok(report.findings.some(x => x.code === "LEDGER_FILL_MISSING_FROM_BROKER"));
});

test("cash and position mismatches are critical", () => {
  const input = fixture({ cash: 9_500, positions: [{ symbol: "BTCUSDT", quantity: 0.5 }] });
  const report = auditPaperRecovery(input);
  assert.equal(report.status, "FAIL");
  assert.ok(report.findings.some(x => x.code === "CASH_RECONCILIATION_MISMATCH"));
  assert.ok(report.findings.some(x => x.code === "POSITION_RECONCILIATION_MISMATCH"));
});

test("duplicate order lifecycle and conflicting fill/rejection are critical", () => {
  const input = fixture({ events: [
    { eventId: "submit_0001", type: "ORDER_SUBMITTED", payload: { clientOrderId: "client_0001" } },
    { eventId: "fill_0001", type: "ORDER_FILLED", payload: { clientOrderId: "client_0001", order: order("client_0001") } },
    { eventId: "fill_0002", type: "ORDER_FILLED", payload: { clientOrderId: "client_0001", order: order("client_0001") } },
    { eventId: "reject_01", type: "ORDER_REJECTED", payload: { clientOrderId: "client_0001" } },
    { eventId: "risk_0001", type: "RISK_EVENT", payload: { state: { halted: false } } }
  ] });
  const report = auditPaperRecovery(input);
  assert.equal(report.status, "FAIL");
  assert.ok(report.findings.some(x => x.code === "DUPLICATE_ORDER_LIFECYCLE_EVENT"));
  assert.ok(report.findings.some(x => x.code === "ORDER_BOTH_FILLED_AND_REJECTED"));
});

test("audit is deterministic and does not mutate inputs", () => {
  const input = fixture();
  const before = structuredClone(input);
  const first = auditPaperRecovery(input);
  const second = auditPaperRecovery(input);
  assert.deepEqual(first, second);
  assert.deepEqual(input, before);
});


test("recovered interrupted order rejection remains REVIEW until manual verification", () => {
  const input = fixture({ events: [
    { eventId: "submit_0001", type: "ORDER_SUBMITTED", payload: { clientOrderId: "client_0001" } },
    { eventId: "reject_0001", type: "ORDER_REJECTED", payload: {
      clientOrderId: "client_0001", message: "submission interrupted before durable fill; manual review required"
    } },
    { eventId: "risk_0001", type: "RISK_EVENT", payload: { state: { halted: false } } }
  ], orders: [], cash: 10_000, positions: [] });
  const report = auditPaperRecovery(input);
  assert.equal(report.status, "REVIEW");
  assert.ok(report.findings.some(x => x.code === "INTERRUPTED_ORDER_REQUIRES_MANUAL_REVIEW"));
});
