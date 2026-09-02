/**
 * Kick incremental desk ingest (API → Postgres) without blocking /desk.
 * Cadence: PI_DESK_REFRESH_MINUTES (default 15). Also on desk load when stale.
 */
import { spawn } from "child_process";
import { join } from "path";
import { resolvePythonCommand } from "./resolvePython";

const DEFAULT_MINUTES = 15;
let lastKickMs = 0;
let running = false;

export function getDeskRefreshIntervalMs(): number {
  const raw = process.env.PI_DESK_REFRESH_MINUTES;
  const parsed = raw === undefined || raw === "" ? DEFAULT_MINUTES : parseFloat(raw);
  const minutes = Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.max(parsed, 1), 180) : DEFAULT_MINUTES;
  return minutes * 60 * 1000;
}

export function deskIngestFreshness(): { lastKickMs: number; running: boolean; intervalMs: number } {
  return { lastKickMs, running, intervalMs: getDeskRefreshIntervalMs() };
}

function spawnStep(script: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const { command, prefixArgs } = resolvePythonCommand();
    const child = spawn(command, [...prefixArgs, join(process.cwd(), script), ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code !== 0) {
        console.warn(`[desk-ingest] ${script} exited ${code}. ${stderr.slice(-400)}`);
      }
      resolve(code ?? 1);
    });
    child.on("error", (err) => {
      console.warn(`[desk-ingest] ${script} spawn:`, err.message);
      resolve(1);
    });
  });
}

async function runChain(): Promise<void> {
  running = true;
  lastKickMs = Date.now();
  try {
    console.log("[desk-ingest] activity/trades → Postgres (incremental)");
    const ingest = await spawnStep("pnl_analysis/live_ingest.py", ["--copy-focus"]);
    if (ingest !== 0) {
      console.warn("[desk-ingest] ingest failed; would-have/promote still run on whatever tape exists");
    }
    await spawnStep("pnl_analysis/would_have_30d.py", []);
    await spawnStep("pnl_analysis/copy_roster.py", []);
    await spawnStep("pnl_analysis/auto_promote.py", []);
    console.log("[desk-ingest] would-have + auto-promote finished");
  } finally {
    running = false;
  }
}

export function maybeRefreshDeskIngest(force = false): { kicked: boolean; running: boolean } {
  const interval = getDeskRefreshIntervalMs();
  const stale = lastKickMs === 0 || Date.now() - lastKickMs >= interval;
  if (running) {
    return { kicked: false, running: true };
  }
  if (!force && !stale) {
    return { kicked: false, running: false };
  }
  void runChain();
  return { kicked: true, running: true };
}

export function startDeskIngestLoop(): void {
  maybeRefreshDeskIngest(true);
  const interval = getDeskRefreshIntervalMs();
  setInterval(() => {
    maybeRefreshDeskIngest(false);
  }, interval).unref();
}
