import test from "node:test";
import assert from "node:assert/strict";

test("dashboard shell contains only snapshot import and no order or mutation controls", async () => {
  const fs = await import("node:fs/promises");
  const html = await fs.readFile(new URL("../dashboard/index.html", import.meta.url), "utf8");
  const js = await fs.readFile(new URL("../dashboard/dashboard.js", import.meta.url), "utf8");
  assert.match(html, /type="file"/);
  assert.doesNotMatch(html, /type="submit"|place order|execute trade|reset risk/i);
  assert.match(js, /buildPaperDashboardViewModel/);
  assert.match(js, /MAX_FILE_BYTES/);
  assert.match(js, /textContent/);
  assert.doesNotMatch(js, /innerHTML|fetch\(|WebSocket|submitOrder|resetRisk/);
});

test("dashboard snapshot rendering uses the established read-only projection", async () => {
  const fs = await import("node:fs/promises");
  const js = await fs.readFile(new URL("../dashboard/dashboard.js", import.meta.url), "utf8");
  assert.match(js, /maySubmitOrders/);
  assert.match(js, /mayMutateLedger/);
  assert.match(js, /mayResetRisk/);
  assert.match(js, /Quote age/);
});
