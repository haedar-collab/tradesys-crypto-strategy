#!/usr/bin/env node
import {
  BINANCE_SPOT_DASHBOARD_CLI_USAGE,
  parseBinanceSpotDashboardCliArgs
} from "../src/paper/binance-spot-dashboard-cli-config.js";
import { startBinanceSpotPaperDashboardRuntime } from "../src/paper/binance-spot-paper-dashboard-runtime.js";

let runtime;
let shutdownPromise;

async function shutdown(signal) {
  shutdownPromise ??= (async () => {
    process.stdout.write("\n[" + signal + "] Shutting down paper dashboard...\n");
    try {
      await runtime?.close();
      process.stdout.write("Paper dashboard stopped cleanly.\n");
    } catch (error) {
      process.stderr.write("Shutdown failed: " + (error?.message ?? String(error)) + "\n");
      process.exitCode = 1;
    }
  })();
  await shutdownPromise;
}

try {
  const config = parseBinanceSpotDashboardCliArgs(process.argv.slice(2));
  if (config.help) {
    process.stdout.write(BINANCE_SPOT_DASHBOARD_CLI_USAGE);
  } else {
    runtime = await startBinanceSpotPaperDashboardRuntime({
      filePath: config.filePath,
      symbols: config.symbols,
      selectedSymbol: config.selectedSymbol,
      host: config.host,
      port: config.port,
      maxQuoteAgeMs: config.maxQuoteAgeMs,
      auth: config.auth,
      sessionOptions: { exclusiveVolume: config.exclusiveVolume }
    });
    const address = runtime.address();
    // Install handlers before the readiness marker so an immediate SIGTERM is handled.
    process.once("SIGINT", () => { void shutdown("SIGINT"); });
    process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
    const baseUrl = "http://" + (config.host.includes(":") ? "[" + config.host + "]" : config.host) + ":" + address.port;
    process.stdout.write("Tradesys Crypto paper dashboard is running.\n");
    process.stdout.write("Dashboard: " + baseUrl + "/dashboard/\n");
    process.stdout.write("Health:    " + baseUrl + "/healthz\n");
    process.stdout.write("API:       " + baseUrl + "/api/paper-dashboard\n");
    process.stdout.write("Mode:      PAPER_ONLY (read-only; no live orders)\n");
    process.stdout.write("Ledger:    " + config.filePath + "\n");
  }
} catch (error) {
  process.stderr.write((error?.message ?? String(error)) + "\n\n" + BINANCE_SPOT_DASHBOARD_CLI_USAGE);
  process.exitCode = 1;
}
