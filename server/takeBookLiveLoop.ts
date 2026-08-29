/**
 * Keep the take book alive with no browser open: rebuild signals, refresh asks,
 * follow paper tickets through kickoff and resolution.
 * Hot-wallet discovery (UW-style) runs on its own 10m loop — see hotWalletDiscoverLoop.
 */
import { runTakeTicketLifecycle } from "./takeTicketLifecycle";
import { startHotWalletDiscoverLoop } from "./hotWalletDiscoverLoop";

const SIGNALS_MS = 60_000;
const TAKES_MS = 30_000;
const LIFE_MS = 60_000;

function baseUrl(): string {
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL.replace(/\/$/, "");
  const port = process.env.PORT || "5000";
  return `http://127.0.0.1:${port}`;
}

let signalsBusy = false;
let takesBusy = false;
let lifeBusy = false;

async function ping(path: string): Promise<void> {
  const res = await fetch(`${baseUrl()}${path}`, {
    headers: { Accept: "application/json", "User-Agent": "PredictionInsider-live-loop/1.0" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    console.warn(`[take-live] ${path} → ${res.status}`);
  }
}

async function tickSignals(): Promise<void> {
  if (signalsBusy) return;
  signalsBusy = true;
  try {
    await ping("/api/signals?refresh=1");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[take-live] signals tick: ${msg}`);
  } finally {
    signalsBusy = false;
  }
}

async function tickTakes(): Promise<void> {
  if (takesBusy) return;
  takesBusy = true;
  try {
    await ping("/api/take-plays");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[take-live] take-plays tick: ${msg}`);
  } finally {
    takesBusy = false;
  }
}

async function tickLife(): Promise<void> {
  if (lifeBusy) return;
  lifeBusy = true;
  try {
    await runTakeTicketLifecycle();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[take-live] lifecycle: ${msg}`);
  } finally {
    lifeBusy = false;
  }
}

export function startTakeBookLiveLoop(): void {
  console.log("[take-live] keepalive on — signals 60s, take-plays 30s, kickoff/grade 60s");
  setTimeout(() => {
    void tickSignals();
    void tickTakes();
    void tickLife();
  }, 8_000);
  setInterval(() => { void tickSignals(); }, SIGNALS_MS);
  setInterval(() => { void tickTakes(); }, TAKES_MS);
  setInterval(() => { void tickLife(); }, LIFE_MS);
  startHotWalletDiscoverLoop();
}
