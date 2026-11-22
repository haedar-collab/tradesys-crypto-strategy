#!/usr/bin/env node
import { resolve } from "node:path";
import {
  listPendingPaperOrderReviews,
  resolveInterruptedPaperOrder
} from "../src/paper/paper-recovery-operations.js";

const USAGE = `Usage:
  npm run paper:resolve-review -- --ledger PATH --list
  npm run paper:resolve-review -- --ledger PATH --client-order-id ID --reviewer NAME --note TEXT

Records an operator resolution (CONFIRMED_NOT_FILLED) for a paper order that was
interrupted before a durable fill. Stop the dashboard first: this takes the ledger lock.
`;

function parse(argv) {
  const values = new Map();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--list" || key === "--help") { values.set(key, true); continue; }
    if (!["--ledger", "--client-order-id", "--reviewer", "--note"].includes(key)) throw new Error("unknown option: " + key);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error("missing value for " + key);
    values.set(key, value); i++;
  }
  return values;
}

try {
  const args = parse(process.argv.slice(2));
  if (args.has("--help")) { process.stdout.write(USAGE); process.exit(0); }
  if (!args.get("--ledger")) throw new Error("--ledger is required");
  const filePath = resolve(args.get("--ledger"));
  const result = args.has("--list")
    ? await listPendingPaperOrderReviews({ filePath })
    : await resolveInterruptedPaperOrder({
      filePath,
      clientOrderId: args.get("--client-order-id"),
      reviewer: args.get("--reviewer"),
      note: args.get("--note")
    });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} catch (error) {
  process.stderr.write((error?.message ?? String(error)) + "\n\n" + USAGE);
  process.exitCode = 1;
}
