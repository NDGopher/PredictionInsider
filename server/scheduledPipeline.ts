/**
 * Run the Python pipeline (merge recent + re-analyze + ingest) on server start if the last
 * successful ingest is older than PI_SMART_REFRESH_HOURS (default 6). Runs in the background.
 */

import { spawn } from "child_process";
import { writeFile, readFile, mkdir } from "fs/promises";
import { join } from "path";
import { getSmartRefreshIntervalMs } from "./pipelineRefreshConfig";
import { resolvePythonCommand } from "./resolvePython";

const LAST_RUN_FILE = join(process.cwd(), "pnl_analysis", "output", ".last_pipeline_run");

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
 * If the pipeline has not been run within the smart-refresh window, spawn it in the background.
 * Call this after the HTTP server is listening (e.g. in the listen callback).
 */
export function runScheduledPipelineIfNeeded(): void {
  setImmediate(async () => {
    try {
      const intervalMs = getSmartRefreshIntervalMs();
      const intervalHours = Math.round(intervalMs / 3600000);
      const last = await getLastRunTime();
      const now = Date.now();
      if (last != null && now - last < intervalMs) {
        console.log(
          `[ScheduledPipeline] Skipping (last run ${Math.round((now - last) / 3600000)}h ago, threshold ${intervalHours}h)`
        );
        return;
      }
      console.log(
        `[ScheduledPipeline] Starting incremental pipeline (merge recent + re-analyze + ingest); threshold ${intervalHours}h`
      );
      const { command, prefixArgs } = resolvePythonCommand();
      const script = join(process.cwd(), "pnl_analysis", "run_full_pipeline.py");
      const child = spawn(command, [...prefixArgs, script, "--incremental", "--ingest"], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, BACKEND_URL: process.env.BACKEND_URL || "http://127.0.0.1:5000" },
      });
      let stderr = "";
      child.stderr?.on("data", (c) => { stderr += c.toString(); });
      child.on("close", (code) => {
        if (code === 0) {
          setLastRunTime().then(() =>
            console.log(`[ScheduledPipeline] Finished successfully; next run after ${intervalHours}h without ingest.`)
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
