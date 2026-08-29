/**
 * Market-first hot wallet discovery loop (Unusual Whales / OddsJam pattern).
 *
 * Every HOT_MS: spawn discover_hot_wallets.py --quick --fetch
 *   top markets → Z-score → light Q on alerts only → enqueue watch → CSV+ingest
 *
 * On successful enqueue/fetch: trigger elite after-hot tick (roster + ranked board).
 */
import { spawn } from "child_process";
import fs from "fs";
import { join } from "path";
import { resolvePythonCommand } from "./resolvePython";
import { triggerEliteTick } from "./eliteContinuousLoop";

/** 10 minutes — UW-style cadence without hammering public APIs */
const HOT_MS = 10 * 60_000;

let busy = false;
let lastStartedAt: number | null = null;
let lastFinishedAt: number | null = null;
let lastExitCode: number | null = null;
let lastError: string | null = null;

export function hotWalletDiscoverStatus(): {
  busy: boolean;
  lastStartedAt: number | null;
  lastFinishedAt: number | null;
  lastExitCode: number | null;
  lastError: string | null;
  intervalMs: number;
} {
  return {
    busy,
    lastStartedAt,
    lastFinishedAt,
    lastExitCode,
    lastError,
    intervalMs: HOT_MS,
  };
}

function readHotDiscoverCounts(): { enqueued: number; csvFetched: number } {
  try {
    const p = join(process.cwd(), "pnl_analysis/output/hot_wallet_discoveries.json");
    if (!fs.existsSync(p)) return { enqueued: 0, csvFetched: 0 };
    const data = JSON.parse(fs.readFileSync(p, "utf8")) as {
      counts?: { enqueued?: number; csv_fetched?: number };
    };
    return {
      enqueued: Number(data.counts?.enqueued || 0),
      csvFetched: Number(data.counts?.csv_fetched || 0),
    };
  } catch {
    return { enqueued: 0, csvFetched: 0 };
  }
}

/**
 * Spawn one quick discovery pass. Returns false if already running.
 */
export function triggerHotWalletDiscover(opts?: {
  quick?: boolean;
  fetch?: boolean;
}): boolean {
  if (busy) {
    console.log("[hot-discover] skip — already running");
    return false;
  }
  busy = true;
  lastStartedAt = Date.now();
  lastError = null;

  const quick = opts?.quick !== false;
  const doFetch = opts?.fetch !== false;
  const { command, prefixArgs } = resolvePythonCommand();
  const script = join(process.cwd(), "pnl_analysis", "discover_hot_wallets.py");
  const args = [...prefixArgs, script];
  if (quick) args.push("--quick");
  if (doFetch) {
    args.push("--fetch", "--fetch-limit", "4");
  }
  args.push("--max-score", quick ? "15" : "20");

  console.log(`[hot-discover] starting: ${command} ${args.join(" ")}`);
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
    if (line) console.log(`[hot-discover] ${line.split("\n").pop()}`);
  });
  child.on("close", (code) => {
    busy = false;
    lastFinishedAt = Date.now();
    lastExitCode = code;
    if (code === 0) {
      console.log("[hot-discover] finished ok");
      const { enqueued, csvFetched } = readHotDiscoverCounts();
      if (enqueued > 0 || csvFetched > 0) {
        console.log(
          `[hot-discover] follow-up after-hot (enqueued=${enqueued} csv=${csvFetched})`,
        );
        // Defer slightly so ingest flush settles
        setTimeout(() => {
          triggerEliteTick("after-hot");
        }, 3_000);
      }
    } else {
      lastError = stderr.slice(-400) || `exit ${code}`;
      console.warn(`[hot-discover] exited ${code}: ${lastError}`);
    }
  });
  child.on("error", (err) => {
    busy = false;
    lastFinishedAt = Date.now();
    lastExitCode = -1;
    lastError = err.message;
    console.warn("[hot-discover] spawn error:", err.message);
  });
  return true;
}

export function startHotWalletDiscoverLoop(): void {
  const mins = Math.round(HOT_MS / 60_000);
  console.log(`[hot-discover] loop on — every ${mins}m (Z→light Q→watch→ingest, then after-hot grade)`);
  setTimeout(() => {
    triggerHotWalletDiscover({ quick: true, fetch: true });
  }, 45_000);
  setInterval(() => {
    triggerHotWalletDiscover({ quick: true, fetch: true });
  }, HOT_MS);
}
