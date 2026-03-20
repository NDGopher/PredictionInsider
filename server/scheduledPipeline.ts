/**
 * Run the Python pipeline (fetch + analyze + ingest) on server start if it hasn't
 * run in the last 24 hours. Runs in the background so the server stays responsive.
 */

import { spawn } from "child_process";
import { writeFile, readFile, mkdir } from "fs/promises";
import { join } from "path";

const LAST_RUN_FILE = join(process.cwd(), "pnl_analysis", "output", ".last_pipeline_run");
const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getLastRunTime(): Promise<number | null> {
  return readFile(LAST_RUN_FILE, "utf-8")
    .then((s) => Math.max(0, parseInt(s.trim(), 10)))
    .catch(() => null);
}

async function setLastRunTime(): Promise<void> {
  try {
    await mkdir(join(process.cwd(), "pnl_analysis", "output"), { recursive: true });
    await writeFile(LAST_RUN_FILE, String(Date.now()), "utf-8");
  } catch (e) {
    console.warn("[ScheduledPipeline] Could not write .last_pipeline_run:", (e as Error)?.message);
  }
}

/**
 * If the pipeline has not been run in the last 24 hours, spawn it in the background.
 * Call this after the HTTP server is listening (e.g. in the listen callback).
 */
export function runScheduledPipelineIfNeeded(): void {
  setImmediate(async () => {
    try {
      const last = await getLastRunTime();
      const now = Date.now();
      if (last != null && now - last < INTERVAL_MS) {
        console.log(
          `[ScheduledPipeline] Skipping (last run ${Math.round((now - last) / 3600000)}h ago, threshold 24h)`
        );
        return;
      }
      console.log("[ScheduledPipeline] Starting incremental pipeline (merge recent + re-analyze + ingest) — has not run in 24h");
      const py = process.platform === "win32" ? "python" : "python3";
      const script = join(process.cwd(), "pnl_analysis", "run_full_pipeline.py");
      const child = spawn(py, [script, "--incremental", "--ingest"], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, BACKEND_URL: process.env.BACKEND_URL || "http://127.0.0.1:5000" },
      });
      let stderr = "";
      child.stderr?.on("data", (c) => { stderr += c.toString(); });
      child.on("close", (code) => {
        if (code === 0) {
          setLastRunTime().then(() =>
            console.log("[ScheduledPipeline] Finished successfully; next run in 24h.")
          );
        } else {
          console.warn(
            `[ScheduledPipeline] Exited with code ${code}. ${stderr.slice(-500) || ""}`
          );
        }
      });
      child.on("error", (err) => {
        console.warn("[ScheduledPipeline] Spawn error:", err.message);
      });
    } catch (e) {
      console.warn("[ScheduledPipeline] Check failed:", (e as Error)?.message);
    }
  });
}
