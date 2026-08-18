/**
 * Bind the app to the first free TCP port (preferred PORT, then nearby).
 * Writes pnl_analysis/output/.runtime.json so Windows launchers can open the browser.
 */
import fs from "fs";
import net from "net";
import path from "path";
import type { Server } from "http";

export const RUNTIME_PATH = path.join(process.cwd(), "pnl_analysis", "output", ".runtime.json");

export interface RuntimeInfo {
  port: number;
  url: string;
  pid: number;
  startedAt: string;
}

function probeFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port, host);
  });
}

export async function pickListenPort(host: string): Promise<number> {
  const raw = parseInt(process.env.PORT || "5000", 10);
  const preferred = Number.isFinite(raw) && raw > 0 ? raw : 5000;
  const candidates: number[] = [];
  for (let p = preferred; p < preferred + 40; p++) candidates.push(p);
  if (preferred !== 5000) {
    for (let p = 5000; p < 5040; p++) {
      if (!candidates.includes(p)) candidates.push(p);
    }
  }
  for (const port of candidates) {
    if (await probeFree(port, host)) return port;
  }
  throw new Error("No free TCP port found near 5000. Close other apps or set PORT in .env.");
}

export function applyListenPort(port: number): RuntimeInfo {
  const url = `http://127.0.0.1:${port}`;
  process.env.PORT = String(port);
  process.env.BACKEND_URL = url;
  const info: RuntimeInfo = {
    port,
    url,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(RUNTIME_PATH), { recursive: true });
  fs.writeFileSync(RUNTIME_PATH, JSON.stringify(info, null, 2), "utf8");
  return info;
}

export function listenHttp(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}
