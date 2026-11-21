import { buildPaperDashboardViewModel } from "../src/paper/paper-dashboard-view-model.js";

const $ = (id) => document.getElementById(id);
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const EMPTY_SNAPSHOT = Object.freeze({
  feedStatus: { state: "DISCONNECTED" },
  riskStatus: null,
  positions: []
});
const format = (value) => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("id-ID", { maximumFractionDigits: 8 }) : "—";
  if (typeof value === "boolean") return value ? "YES" : "NO";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
  return String(value);
};
function setText(id, value) { $(id).textContent = format(value); }
function renderDetails(id, entries) {
  const target = $(id);
  target.replaceChildren();
  for (const [label, value] of entries) {
    const dt = document.createElement("dt"), dd = document.createElement("dd");
    dt.textContent = label; dd.textContent = format(value);
    target.append(dt, dd);
  }
}
function render(vm) {
  setText("market-state", vm.market.state);
  renderDetails("market-details", [
    ["Symbol", vm.market.symbol], ["Bid", vm.market.bid], ["Ask", vm.market.ask],
    ["Spread", vm.market.spread], ["Quote age (ms)", vm.market.quoteAgeMs],
    ["Max age (ms)", vm.market.maxQuoteAgeMs], ["Source", vm.market.source],
    ["Selected symbol", vm.market.selectedSymbol],
    ["Healthy symbols", vm.market.healthySymbolCount === null ? null : vm.market.healthySymbolCount + " / " + vm.market.symbolCount],
    ["Per-symbol health", vm.market.feeds.map(feed => feed.symbol + ": " + (feed.healthy ? "HEALTHY" : feed.state + (feed.reason ? " (" + feed.reason + ")" : "")))]
  ]);
  setText("strategy-state", vm.strategy.status);
  renderDetails("strategy-details", [
    ["Symbol", vm.strategy.symbol], ["Side", vm.strategy.side],
    ["Decision", vm.strategy.decision], ["Signal ID", vm.strategy.signalId]
  ]);
  setText("risk-state", vm.risk.state);
  renderDetails("risk-details", [
    ["Halted", vm.risk.halted], ["Reasons", vm.risk.reasons],
    ["Daily loss (%)", vm.risk.dailyLossPct], ["Drawdown (%)", vm.risk.drawdownPct],
    ["Exposure (%)", vm.risk.exposurePct]
  ]);
  setText("performance-state", vm.performance.status);
  renderDetails("performance-details", [
    ["Net realized PnL", vm.performance.netRealizedPnl],
    ["Net realized return (%)", vm.performance.netRealizedReturnPct],
    ["Win rate (%)", vm.performance.winRatePct], ["Profit factor", vm.performance.profitFactor],
    ["Max drawdown (%)", vm.performance.maxDrawdownPct],
    ["Closed trades", vm.performance.closedTradeCount], ["Fees", vm.performance.totalFees],
    ["Equity marks", vm.performance.equityMarkCount]
  ]);
  setText("position-summary", vm.portfolio.positionCount + " positions · " + vm.portfolio.unmarkedPositionCount + " unmarked");
  const body = $("positions"); body.replaceChildren();
  for (const position of vm.portfolio.positions) {
    const tr = document.createElement("tr");
    for (const value of [position.symbol, position.quantity, position.markPrice, position.marketValue, position.markStatus]) {
      const td = document.createElement("td"); td.textContent = format(value); tr.append(td);
    }
    body.append(tr);
  }
  renderDetails("quality-details", [
    ["Ledger", vm.dataQuality.ledger], ["Equity history", vm.dataQuality.equityHistory],
    ["Unmarked positions", vm.dataQuality.hasUnmarkedPositions]
  ]);
  renderDetails("permission-details", [
    ["Mode", vm.mode], ["Read only", vm.permissions.readOnly],
    ["May submit orders", vm.permissions.maySubmitOrders],
    ["May mutate ledger", vm.permissions.mayMutateLedger],
    ["May reset risk", vm.permissions.mayResetRisk]
  ]);
}
function loadSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new TypeError("Snapshot harus berupa object JSON.");
  const vm = snapshot.viewModel && snapshot.viewModel.mode === "PAPER_ONLY"
    ? snapshot.viewModel
    : buildPaperDashboardViewModel({ ...snapshot, now: Date.now() });
  render(vm);
  setText("load-status", "Snapshot berhasil dimuat · " + new Date().toLocaleString("id-ID"));
}
$("snapshot-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > MAX_FILE_BYTES) throw new RangeError("Ukuran snapshot melebihi 2 MB.");
    const parsed = JSON.parse(await file.text());
    loadSnapshot(parsed);
  } catch (error) {
    setText("load-status", "Gagal memuat: " + error.message);
  }
});
$("load-demo").addEventListener("click", () => {
  loadSnapshot(EMPTY_SNAPSHOT);
  setText("load-status", "Contoh kosong dimuat. Belum ada data runtime.");
});
render(buildPaperDashboardViewModel(EMPTY_SNAPSHOT));


let runtimeTimer = null;
let runtimeBusy = false;
async function refreshRuntime() {
  if (runtimeBusy) return;
  runtimeBusy = true;
  try {
    const response = await fetch("/api/paper-dashboard", {
      method: "GET", cache: "no-store", credentials: "same-origin",
      headers: { "accept": "application/json" }
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const payload = await response.json();
    if (payload.schemaVersion !== 1 || !payload.viewModel ||
        payload.viewModel.mode !== "PAPER_ONLY" ||
        payload.viewModel.permissions?.maySubmitOrders !== false ||
        payload.viewModel.permissions?.mayMutateLedger !== false ||
        payload.viewModel.permissions?.mayResetRisk !== false) {
      throw new Error("Respons runtime tidak valid atau bukan read-only.");
    }
    render(payload.viewModel);
    setText("load-status", "Runtime terhubung · diperbarui " +
      new Date(payload.generatedAt).toLocaleTimeString("id-ID"));
  } catch (error) {
    render(buildPaperDashboardViewModel(EMPTY_SNAPSHOT));
    setText("load-status", "Runtime terputus / tidak tersedia · " + error.message);
  } finally {
    runtimeBusy = false;
  }
}
$("connect-runtime").addEventListener("click", async () => {
  if (runtimeTimer !== null) {
    clearInterval(runtimeTimer);
    runtimeTimer = null;
    $("connect-runtime").textContent = "Hubungkan runtime";
    setText("load-status", "Pembaruan runtime dihentikan.");
    return;
  }
  $("connect-runtime").textContent = "Putuskan runtime";
  await refreshRuntime();
  runtimeTimer = setInterval(refreshRuntime, 3000);
});
