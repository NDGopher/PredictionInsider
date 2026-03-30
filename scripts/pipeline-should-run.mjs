/**
 * Exit code for start-prediction-insider.bat (smart mode):
 *   0 = skip Python pipeline (last successful ingest < 24h ago)
 *   1 = run pipeline (never ingested, stale, or PI_FORCE_REFRESH=1)
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lastFile = join(root, "pnl_analysis", "output", ".last_pipeline_run");
const INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Deliberate same-day refresh — use this name so stray shells don't inherit a generic FORCE_PIPELINE. */
if (process.env.PI_FORCE_REFRESH === "1") {
  console.log("[smart] PI_FORCE_REFRESH=1 — will run pipeline.");
  process.exit(1);
}

if (!existsSync(lastFile)) {
  console.log("[smart] No .last_pipeline_run — will run pipeline.");
  process.exit(1);
}

let last;
try {
  last = parseInt(readFileSync(lastFile, "utf8").trim(), 10);
} catch {
  console.log("[smart] Could not read timestamp — will run pipeline.");
  process.exit(1);
}

if (Number.isNaN(last)) {
  process.exit(1);
}

const age = Date.now() - last;
if (age >= INTERVAL_MS) {
  console.log(`[smart] Last ingest was ${Math.round(age / 3600000)}h ago — will run pipeline.`);
  process.exit(1);
}

console.log(
  `[smart] Skipping Python pipeline — last successful ingest ${Math.round(age / 3600000)}h ago (threshold 24h). Server will still start.`
);
process.exit(0);
