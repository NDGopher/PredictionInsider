/**
 * Elite continuous product loop — keeps grading / promote / board fresh
 * while the server stays up (no external cron required).
 *
 * Cadence (single-flight; skips if another elite tick is busy):
 *   micro   ~15m  ranked opens + take health
 *   promote ~45m  adaptive lab + auto_promote + roster + ranked + health
 *
 * Hot-discover follow-up (after-hot) is triggered from hotWalletDiscoverLoop
 * when new wallets were enqueued/fetched.
 *
 * Full cold roster ingest remains on scheduledPipeline (smart refresh hours).
 */
import { spawn } from "child_process";
import { join } from "path";
import { resolvePythonCommand } from "./resolvePython";

const MICRO_MS = 15 * 60_000;
const PROMOTE_MS = 45 * 60_000;

type EliteMode = "micro" | "promote" | "after-hot" | "full-lite";

let busy = false;
let lastMode: EliteMode | null = null;
let lastStartedAt: number | null = null;
let lastFinishedAt: number | null = null;
let lastExitCode: number | null = null;
let lastError: string | null = null;

export function eliteContinuousStatus(): {
  busy: boolean;
  lastMode: EliteMode | null;
  lastStartedAt: number | null;
  lastFinishedAt: number | null;
  lastExitCode: number | null;
  lastError: string | null;
  microIntervalMs: number;
  promoteIntervalMs: number;
} {
  return {
    busy,
    lastMode,
    lastStartedAt,
    lastFinishedAt,
    lastExitCode,
    lastError,
    microIntervalMs: MICRO_MS,
    promoteIntervalMs: PROMOTE_MS,
  };
}

function spawnEliteTick(mode: EliteMode): boolean {
  if (busy) {
    console.log(`[elite-loop] skip ${mode} — already running`);
    return false;
  }
  busy = true;
  lastMode = mode;
  lastStartedAt = Date.now();
  lastError = null;

  const { command, prefixArgs } = resolvePythonCommand();
  const script = join(process.cwd(), "pnl_analysis", "elite_continuous_tick.py");
  const args = [...prefixArgs, script, "--mode", mode];
  console.log(`[elite-loop] starting ${mode}: ${command} ${args.join(" ")}`);

  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  let stderr = "";
  child.stderr?.on("data", (c: Buffer) => {
    stderr += c.toString();
  });
  child.stdout?.on("data", (c: Buffer) => {
    const line = c.toString().trim();
    if (line) console.log(`[elite-loop] ${line.split("\n").pop()}`);
  });
  child.on("close", (code) => {
    busy = false;
    lastFinishedAt = Date.now();
    lastExitCode = code;
    if (code === 0) {
      console.log(`[elite-loop] ${mode} finished ok`);
    } else {
      lastError = stderr.slice(-400) || `exit ${code}`;
      console.warn(`[elite-loop] ${mode} exited ${code}: ${lastError}`);
    }
  });
  child.on("error", (err) => {
    busy = false;
    lastFinishedAt = Date.now();
    lastExitCode = -1;
    lastError = err.message;
    console.warn(`[elite-loop] spawn error:`, err.message);
  });
  return true;
}

/** Public trigger — used by hot-discover follow-up and API. */
export function triggerEliteTick(mode: EliteMode = "micro"): boolean {
  return spawnEliteTick(mode);
}

export function startEliteContinuousLoop(): void {
  console.log(
    `[elite-loop] on — micro every ${Math.round(MICRO_MS / 60_000)}m, `
      + `promote every ${Math.round(PROMOTE_MS / 60_000)}m`,
  );
  // Warmup: first micro after signals settle; first promote later
  setTimeout(() => {
    spawnEliteTick("micro");
  }, 90_000);
  setTimeout(() => {
    spawnEliteTick("promote");
  }, 8 * 60_000);

  setInterval(() => {
    spawnEliteTick("micro");
  }, MICRO_MS);
  setInterval(() => {
    spawnEliteTick("promote");
  }, PROMOTE_MS);
}
