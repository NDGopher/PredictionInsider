import "dotenv/config";
import { exec } from "child_process";
import express, { type Request, Response, NextFunction } from "express";
import { applyListenPort, listenHttp, pickListenPort } from "./bindPort";
import { registerRoutes } from "./routes";
import { logTelegramStartup } from "./telegramTakeAlerts";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.get("/api/healthz", (_req, res) => {
  res.json({ ok: true, port: Number(process.env.PORT || 0) });
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // Prefer PORT from .env; if that socket is taken, use the next free port.
  const host = process.platform === "win32" && process.env.NODE_ENV !== "production"
    ? "127.0.0.1"
    : "0.0.0.0";
  let port = await pickListenPort(host);
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await listenHttp(httpServer, port, host);
      break;
    } catch (err: unknown) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
      if (code !== "EADDRINUSE") throw err;
      log(`port ${port} in use, trying ${port + 1}`);
      port += 1;
      if (attempt === 39) throw err;
    }
  }
  const runtime = applyListenPort(port);
  log(`serving on ${runtime.url}`);
  log(`OPEN THIS IN YOUR BROWSER → ${runtime.url}`);
  logTelegramStartup();
  if (
    process.platform === "win32"
    && process.env.NODE_ENV !== "production"
    && process.env.PI_NO_BROWSER !== "1"
  ) {
    exec(`cmd /c start "" "${runtime.url}"`);
  }
  import("./scheduledPipeline").then((m) => m.runScheduledPipelineIfNeeded());
  import("./takeBookLiveLoop").then((m) => m.startTakeBookLiveLoop());
})();
