/**
 * Exit code for start-prediction-insider.bat (smart mode):
 *   0 = skip Python pipeline (last successful ingest within PI_SMART_REFRESH_HOURS, default 6)
 *   1 = run pipeline (never ingested, stale, or PI_FORCE_REFRESH=1)
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lastFile = join(root, "pnl_analysis", "output", ".last_pipeline_run");

/** Same default as server/pipelineRefreshConfig.ts — PI_SMART_REFRESH_HOURS (1–168), default 6 */
function getSmartRefreshIntervalMs() {
  const raw = process.env.PI_SMART_REFRESH_HOURS;
  const parsed = raw === undefined || raw === "" ? 6 : parseFloat(raw);
  const hours = Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.max(parsed, 1), 168) : 6;
  return hours * 60 * 60 * 1000;
}
const INTERVAL_MS = getSmartRefreshIntervalMs();

/** Deliberate same-day refresh — use this name so stray shells don't inherit a generic FORCE_PIPELINE. */
if (process.env.PI_FORCE_REFRESH === "1") {
  console.log("[smart] PI_FORCE_REFRESH=1 - will run pipeline.");
  process.exit(1);
}

if (!existsSync(lastFile)) {
  console.log("[smart] No .last_pipeline_run - will run pipeline.");
  process.exit(1);
}

let last;
try {
  last = parseInt(readFileSync(lastFile, "utf8").trim(), 10);
} catch {
  console.log("[smart] Could not read timestamp - will run pipeline.");
  process.exit(1);
}

if (Number.isNaN(last)) {
  process.exit(1);
}

const age = Date.now() - last;
if (age >= INTERVAL_MS) {
  console.log(`[smart] Last ingest was ${Math.round(age / 3600000)}h ago - will run pipeline.`);
  process.exit(1);
}

const th = Math.round(INTERVAL_MS / 3600000);
console.log(
  `[smart] Skipping Python pipeline - last successful ingest ${Math.round(age / 3600000)}h ago (threshold ${th}h). Server will still start.`
);
process.exit(0);
