import { buildPaperPerformanceReport } from "./paper-performance-analytics.js";

/**
 * Build a performance report from a verified persistent-ledger snapshot.
 * A COMPLETE snapshot is required; equity marks are sourced only from durable
 * POSITION_MARKED events. No synthetic mark or price is generated here.
 */
export function buildPaperPerformanceReportFromLedger({
  ledgerSnapshot,
  initialEquity
} = {}) {
  if (!ledgerSnapshot || ledgerSnapshot.status !== "COMPLETE" ||
      !Array.isArray(ledgerSnapshot.events) ||
      !Number.isSafeInteger(ledgerSnapshot.eventCount) ||
      ledgerSnapshot.eventCount !== ledgerSnapshot.events.length ||
      ledgerSnapshot.lastSequence !== ledgerSnapshot.eventCount) {
    throw new TypeError("a complete, internally consistent ledger snapshot is required");
  }

  const events = ledgerSnapshot.events;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event || event.sequence !== i + 1 ||
        typeof event.eventId !== "string" ||
        !Number.isSafeInteger(event.timestamp) ||
        !event.payload || typeof event.payload !== "object") {
      throw new TypeError("ledger snapshot contains an invalid event at index " + i);
    }
  }

  const equitySnapshots = events
    .filter((event) => event.type === "POSITION_MARKED")
    .map((event) => {
      const equity = event.payload.equity;
      if (!Number.isFinite(equity) || equity <= 0) {
        throw new TypeError("POSITION_MARKED event is missing a valid equity value");
      }
      return { timestamp: event.timestamp, equity };
    });

  const report = buildPaperPerformanceReport({
    events,
    initialEquity,
    equitySnapshots
  });

  return Object.freeze({
    ...report,
    source: Object.freeze({
      type: "PERSISTENT_PAPER_LEDGER",
      eventCount: ledgerSnapshot.eventCount,
      lastSequence: ledgerSnapshot.lastSequence,
      lastHash: ledgerSnapshot.lastHash,
      equityMarkCount: equitySnapshots.length
    }),
    status: equitySnapshots.length ? "COMPLETE" : "INCOMPLETE_EQUITY_HISTORY",
    limitations: Object.freeze([
      ...report.limitations,
      ...(equitySnapshots.length ? [] : ["No durable POSITION_MARKED events exist; drawdown is not measurable beyond initial equity."]),
      "Report is a snapshot of recorded ledger events; it does not prove future profitability."
    ])
  });
}
