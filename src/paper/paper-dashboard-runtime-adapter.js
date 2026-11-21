import { buildPaperPerformanceReportFromLedger } from "./paper-performance-ledger-adapter.js";
import { buildPaperDashboardViewModel } from "./paper-dashboard-view-model.js";

const clone = value => value == null ? value : structuredClone(value);
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);

function validateSessionSnapshot(snapshot) {
  if (!isRecord(snapshot) || snapshot.mode !== "PAPER_ONLY" ||
      !isRecord(snapshot.broker) || !isRecord(snapshot.ledger) ||
      snapshot.ledger.status !== "COMPLETE" ||
      !Array.isArray(snapshot.ledger.events) ||
      !Number.isSafeInteger(snapshot.ledger.eventCount) ||
      snapshot.ledger.eventCount !== snapshot.ledger.events.length ||
      snapshot.ledger.lastSequence !== snapshot.ledger.eventCount ||
      !snapshot.ledger.events.every((event, index) =>
        event && event.sequence === index + 1 && typeof event.eventId === "string" &&
        typeof event.hash === "string" && event.hash.length === 64) ||
      !Number.isFinite(snapshot.broker.cash) ||
      !Array.isArray(snapshot.broker.positions)) {
    throw new Error("runtime dashboard snapshot rejected: incomplete or inconsistent paper session snapshot");
  }
  return snapshot;
}

/**
 * Build a read-only dashboard projection from a live in-process paper session.
 * Providers are read-only callbacks supplied by the host application. This
 * adapter never opens exchange connections and never receives mutation methods.
 */
export async function createPaperDashboardRuntimeSnapshot({
  session,
  feedProvider = async () => ({ status: { state: "DISCONNECTED" }, quote: null }),
  strategyProvider = async () => ({ signal: null, acceptance: null }),
  maxQuoteAgeMs = 5_000,
  now = () => Date.now()
} = {}) {
  if (!session || typeof session.snapshot !== "function") {
    throw new TypeError("a read-only compatible paper session is required");
  }
  if (typeof feedProvider !== "function" || typeof strategyProvider !== "function" || typeof now !== "function") {
    throw new TypeError("providers and clock must be functions");
  }

  const [rawSession, rawFeed, rawStrategy] = await Promise.all([
    session.snapshot(), feedProvider(), strategyProvider()
  ]);
  const state = validateSessionSnapshot(rawSession);
  if (!isRecord(rawFeed) || !isRecord(rawStrategy)) {
    throw new TypeError("feed and strategy providers must return objects");
  }
  // Use risk from the same atomic session snapshot; a second status read could
  // race with an order or mark update and display mismatched portfolio/risk.
  const riskStatus = clone(state.risk ?? null);
  const ledgerSnapshot = clone(state.ledger);
  const latestMark = [...ledgerSnapshot.events].reverse().find(event => event.type === "POSITION_MARKED");
  const marks = new Map((latestMark?.payload?.marks ?? []).map(mark => [mark.symbol, mark]));
  const positions = state.broker.positions.map(position => {
    const mark = marks.get(position.symbol);
    return {
      symbol: position.symbol,
      quantity: position.quantity,
      markPrice: mark && Math.abs(mark.quantity - position.quantity) <= 1e-9
        ? mark.markPrice : null
    };
  });
  const performanceReport = buildPaperPerformanceReportFromLedger({
    ledgerSnapshot,
    initialEquity: state.broker.initialCash
  });
  const timestamp = now();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new TypeError("now must return UTC epoch milliseconds");

  const snapshot = {
    generatedAt: timestamp,
    mode: "PAPER_ONLY",
    feedStatus: clone(rawFeed.status ?? { state: "DISCONNECTED" }),
    quote: clone(rawFeed.quote ?? null),
    signal: clone(rawStrategy.signal ?? null),
    acceptance: clone(rawStrategy.acceptance ?? null),
    screener: clone(rawStrategy.screener ?? null),
    ledgerSnapshot,
    performanceReport,
    riskStatus,
    positions,
    maxQuoteAgeMs
  };
  const viewModel = buildPaperDashboardViewModel({ ...snapshot, now: timestamp });
  return Object.freeze({
    schemaVersion: 1,
    generatedAt: timestamp,
    source: Object.freeze({
      type: "IN_PROCESS_PAPER_SESSION",
      mode: "PAPER_ONLY",
      ledgerEventCount: ledgerSnapshot.eventCount,
      ledgerLastHash: ledgerSnapshot.lastHash
    }),
    snapshot: Object.freeze(snapshot),
    viewModel
  });
}
