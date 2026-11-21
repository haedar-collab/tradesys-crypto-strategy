const EPSILON = 1e-8;
const clone = (value) => structuredClone(value);
const closeEnough = (a, b) => Number.isFinite(a) && Number.isFinite(b) &&
  Math.abs(a - b) <= EPSILON * Math.max(1, Math.abs(a), Math.abs(b));

function finding(code, severity, message, reference = null, action = null) {
  return { code, severity, message, reference, action };
}

/**
 * Read-only operational audit. It does not mutate the ledger or broker,
 * repair balances, replay orders, or clear filesystem locks.
 */
export function auditPaperRecovery({ ledgerSnapshot, brokerSnapshot, initialCash, expectedConfig } = {}) {
  const findings = [];
  if (!ledgerSnapshot || ledgerSnapshot.status !== "COMPLETE" ||
      !Array.isArray(ledgerSnapshot.events) ||
      ledgerSnapshot.eventCount !== ledgerSnapshot.events.length ||
      ledgerSnapshot.lastSequence !== ledgerSnapshot.events.length ||
      typeof ledgerSnapshot.lastHash !== "string") {
    return Object.freeze({
      status: "FAIL",
      findings: Object.freeze([finding(
        "LEDGER_SNAPSHOT_UNVERIFIED", "CRITICAL",
        "A complete, internally consistent verified ledger snapshot is required.",
        null, "Re-open the ledger through its hash-chain verifier; do not edit the file manually."
      )]),
      summary: { critical: 1, error: 0, warning: 0, info: 0 }
    });
  }
  if (!brokerSnapshot || !Array.isArray(brokerSnapshot.orders) ||
      !Array.isArray(brokerSnapshot.positions) || !Number.isFinite(brokerSnapshot.cash) ||
      !Number.isFinite(initialCash) || initialCash <= 0) {
    return Object.freeze({
      status: "FAIL",
      findings: Object.freeze([finding(
        "BROKER_SNAPSHOT_INVALID", "CRITICAL",
        "A valid broker snapshot and positive initialCash are required.",
        null, "Restore the paper broker from durable fills and rerun the audit."
      )]),
      summary: { critical: 1, error: 0, warning: 0, info: 0 }
    });
  }

  const events = ledgerSnapshot.events;
  const headers = events.filter(entry => entry.type === "SESSION_STARTED");
  if (headers.length !== 1 || events[0]?.type !== "SESSION_STARTED") {
    findings.push(finding("SESSION_CONFIG_HEADER_INVALID", "CRITICAL",
      "Ledger must begin with exactly one immutable SESSION_STARTED configuration header.",
      null, "Do not activate this ledger; migrate only through a reviewed, backed-up procedure."));
  } else if (!headers[0].payload?.config ||
      (expectedConfig && JSON.stringify({
        ...headers[0].payload.config,
        requireMarketDataProvenance: headers[0].payload.config.requireMarketDataProvenance ?? false
      }) !== JSON.stringify({
        ...expectedConfig,
        requireMarketDataProvenance: expectedConfig.requireMarketDataProvenance ?? false
      }))) {
    findings.push(finding("SESSION_CONFIG_MISMATCH", "CRITICAL",
      "Persisted session configuration does not match the requested configuration.",
      headers[0].eventId, "Reopen using the original immutable configuration; do not overwrite it."));
  }
  const ids = new Set();
  const intents = new Map();
  const fills = new Map();
  const rejections = new Map();
  const riskEvents = [];
  for (const entry of events) {
    if (!entry || typeof entry.eventId !== "string" || ids.has(entry.eventId)) {
      findings.push(finding("DUPLICATE_OR_INVALID_EVENT_ID", "CRITICAL",
        "Ledger contains a duplicate or invalid event identifier.", entry?.eventId ?? null,
        "Stop session activation and investigate the ledger integrity."));
      continue;
    }
    ids.add(entry.eventId);
    const payload = entry.payload ?? {};
    if (["ORDER_SUBMITTED", "ORDER_FILLED", "ORDER_REJECTED"].includes(entry.type)) {
      const id = payload.clientOrderId;
      if (typeof id !== "string" || !id) {
        findings.push(finding("ORDER_EVENT_MISSING_CLIENT_ID", "CRITICAL",
          "An order event has no clientOrderId.", entry.eventId,
          "Quarantine the session and inspect the original event."));
        continue;
      }
      const target = entry.type === "ORDER_SUBMITTED" ? intents :
        entry.type === "ORDER_FILLED" ? fills : rejections;
      if (target.has(id)) {
        findings.push(finding("DUPLICATE_ORDER_LIFECYCLE_EVENT", "CRITICAL",
          "More than one event of the same lifecycle type exists for a clientOrderId.",
          id, "Do not replay or repair automatically; inspect the full event history."));
      } else target.set(id, entry);
    }
    if (entry.type === "RISK_EVENT") riskEvents.push(entry);
  }

  for (const [id, entry] of rejections) {
    if (/manual review required/i.test(entry.payload?.message ?? "")) {
      findings.push(finding("INTERRUPTED_ORDER_REQUIRES_MANUAL_REVIEW", "ERROR",
        "A prior interrupted submission was safely rejected during recovery but still requires operator review.", id,
        "Verify external execution evidence before treating the intent as resolved."));
    }
  }
  for (const [id] of intents) {
    if (!fills.has(id) && !rejections.has(id)) {
      findings.push(finding("AMBIGUOUS_ORDER_INTENT", "ERROR",
        "Order intent has no durable fill or rejection terminal event.", id,
        "Check broker/execution evidence manually. Never auto-submit this intent."));
    }
  }
  for (const id of fills.keys()) {
    if (!intents.has(id)) findings.push(finding("FILL_WITHOUT_INTENT", "CRITICAL",
      "A durable fill has no matching write-ahead order intent.", id,
      "Quarantine the ledger and investigate event provenance."));
    if (rejections.has(id)) findings.push(finding("ORDER_BOTH_FILLED_AND_REJECTED", "CRITICAL",
      "The same order is recorded as both filled and rejected.", id,
      "Do not activate trading; investigate the conflicting terminal records."));
  }
  for (const id of rejections.keys()) {
    if (!intents.has(id)) findings.push(finding("REJECTION_WITHOUT_INTENT", "ERROR",
      "A rejection has no matching order intent.", id,
      "Inspect event provenance before continuing."));
  }

  const brokerOrders = new Map();
  for (const order of brokerSnapshot.orders) {
    if (!order || typeof order.clientOrderId !== "string" || brokerOrders.has(order.clientOrderId)) {
      findings.push(finding("BROKER_DUPLICATE_OR_INVALID_ORDER", "CRITICAL",
        "Broker snapshot contains a duplicate or invalid order identifier.", null,
        "Rebuild the broker snapshot from verified durable fills."));
      continue;
    }
    brokerOrders.set(order.clientOrderId, order);
  }

  for (const [id, entry] of fills) {
    const recorded = entry.payload?.order;
    const actual = brokerOrders.get(id);
    if (!actual) {
      findings.push(finding("LEDGER_FILL_MISSING_FROM_BROKER", "CRITICAL",
        "Ledger records a fill that is absent from the reconstructed broker.", id,
        "Do not activate the session; inspect replay determinism and fill payload."));
    } else if (!recorded || recorded.status !== "FILLED" ||
      recorded.symbol !== actual.symbol || recorded.side !== actual.side ||
      !closeEnough(recorded.quantity, actual.quantity) ||
      !closeEnough(recorded.fillPrice, actual.fillPrice) ||
      !closeEnough(recorded.fee, actual.fee) ||
      !closeEnough(recorded.gross, actual.gross)) {
      findings.push(finding("LEDGER_BROKER_FILL_MISMATCH", "CRITICAL",
        "Recorded fill details differ from the reconstructed broker order.", id,
        "Quarantine the session and investigate replay inputs and broker version."));
    }
  }
  for (const id of brokerOrders.keys()) {
    if (!fills.has(id)) findings.push(finding("BROKER_FILL_MISSING_FROM_LEDGER", "CRITICAL",
      "Broker contains a fill with no durable ledger fill event.", id,
      "Do not infer or append a replacement fill automatically."));
  }

  let expectedCash = initialCash;
  const expectedPositions = new Map();
  for (const [id, entry] of fills) {
    const order = entry.payload?.order;
    if (!order || !Number.isFinite(order.gross) || !Number.isFinite(order.fee) ||
        !Number.isFinite(order.quantity) || order.quantity <= 0 ||
        !["BUY", "SELL"].includes(order.side) || typeof order.symbol !== "string") continue;
    const current = expectedPositions.get(order.symbol) ?? 0;
    if (order.side === "BUY") {
      expectedCash -= order.gross + order.fee;
      expectedPositions.set(order.symbol, current + order.quantity);
    } else {
      expectedCash += order.gross - order.fee;
      expectedPositions.set(order.symbol, current - order.quantity);
    }
  }
  for (const [symbol, quantity] of expectedPositions) {
    if (quantity < -EPSILON) findings.push(finding("LEDGER_NEGATIVE_POSITION", "CRITICAL",
      "Ledger fills imply a negative spot position.", symbol,
      "Inspect SELL fills and their preceding BUY inventory."));
    if (Math.abs(quantity) <= EPSILON) expectedPositions.delete(symbol);
  }
  if (!closeEnough(expectedCash, brokerSnapshot.cash)) {
    findings.push(finding("CASH_RECONCILIATION_MISMATCH", "CRITICAL",
      "Cash reconstructed from ledger fills does not match broker cash.",
      { expected: expectedCash, actual: brokerSnapshot.cash },
      "Do not adjust balances automatically; inspect fills, fees, and initialCash."));
  }
  const actualPositions = new Map(brokerSnapshot.positions.map(p => [p.symbol, p.quantity]));
  const symbols = new Set([...expectedPositions.keys(), ...actualPositions.keys()]);
  for (const symbol of symbols) {
    const expected = expectedPositions.get(symbol) ?? 0;
    const actual = actualPositions.get(symbol) ?? 0;
    if (!closeEnough(expected, actual)) findings.push(finding(
      "POSITION_RECONCILIATION_MISMATCH", "CRITICAL",
      "Position quantity reconstructed from ledger fills does not match broker quantity.",
      { symbol, expected, actual },
      "Do not adjust inventory automatically; inspect order sequence and replay."
    ));
  }

  if (riskEvents.length === 0) findings.push(finding("RISK_STATE_MISSING", "WARNING",
    "No persisted risk-state event exists in the ledger.", null,
    "Confirm this is an intentionally legacy ledger before enabling new entries."));
  else {
    const latest = riskEvents[riskEvents.length - 1];
    if (!latest.payload?.state || typeof latest.payload.state.halted !== "boolean") {
      findings.push(finding("LATEST_RISK_STATE_INVALID", "CRITICAL",
        "Latest risk event has no valid persisted monitor state.", latest.eventId,
        "Do not enable entries until risk state is reconstructed and reviewed."));
    }
  }

  const summary = {
    critical: findings.filter(x => x.severity === "CRITICAL").length,
    error: findings.filter(x => x.severity === "ERROR").length,
    warning: findings.filter(x => x.severity === "WARNING").length,
    info: findings.filter(x => x.severity === "INFO").length
  };
  const status = summary.critical ? "FAIL" : summary.error ? "REVIEW" : "PASS";
  return Object.freeze({
    status,
    findings: Object.freeze(findings.map(x => Object.freeze(clone(x)))),
    summary: Object.freeze(summary),
    ledger: Object.freeze({
      eventCount: ledgerSnapshot.eventCount,
      lastSequence: ledgerSnapshot.lastSequence,
      lastHash: ledgerSnapshot.lastHash
    }),
    broker: Object.freeze({ orderCount: brokerOrders.size, cash: brokerSnapshot.cash })
  });
}
