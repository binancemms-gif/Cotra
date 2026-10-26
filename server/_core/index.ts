import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { getPumpStreamStatus, getRecentPumpTrades, startPumpTradeStream, stopPumpTradeStream, subscribePumpStream } from "../providers/pump-stream";

function isSameOriginRequest(req: import("express").Request) {
  const fetchSite = req.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin") return false;
  if (fetchSite === "same-origin") return true;
  const origin = req.get("origin");
  const forwardedHost = req.get("x-forwarded-host")?.split(",")[0]?.trim();
  const hosts = [forwardedHost, req.get("host")].filter((value): value is string => Boolean(value)).map(value => value.trim().toLowerCase());
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0]?.trim().replace(/:$/, "");
  const protocols = [forwardedProto, req.protocol].filter(Boolean).map(value => `${value!.toLowerCase().replace(/:$/, "")}:`);
  if (!origin || !hosts.length || !protocols.length) return false;
  try {
    const parsed = new URL(origin);
    return !parsed.username && !parsed.password && hosts.includes(parsed.host.toLowerCase()) && protocols.includes(parsed.protocol);
  } catch { return false; }
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/stream/pump/status", (_req, res) => {
    res.set("Cache-Control", "no-store").json(getPumpStreamStatus());
  });
  const streamClients = new Set<object>();
  app.post("/api/stream/pump/start", (req, res) => {
    if (!isSameOriginRequest(req)) return res.status(403).json({ error: "A same-origin request is required to start the mainnet stream." });
    if (streamClients.size === 0) return res.status(409).json({ error: "Open the live-feed panel before starting the upstream stream." });
    startPumpTradeStream();
    return res.status(202).set("Cache-Control", "no-store").json({ status: getPumpStreamStatus() });
  });
  app.post("/api/stream/pump/stop", (req, res) => {
    if (!isSameOriginRequest(req)) return res.status(403).json({ error: "A same-origin request is required to stop the mainnet stream." });
    stopPumpTradeStream();
    return res.set("Cache-Control", "no-store").json({ status: getPumpStreamStatus() });
  });
  app.get("/api/stream/pump", (req, res) => {
    if (streamClients.size >= 100) return res.status(503).json({ error: "Live-stream client limit reached." });
    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    streamClients.add(res);
    const emit = (event: string, data: unknown) => {
      if (!res.writableEnded && !res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const unsubscribe = subscribePumpStream({ onTrade: event => emit("trade", event), onStatus: status => emit("status", status) });
    emit("snapshot", { status: getPumpStreamStatus(), trades: getRecentPumpTrades() });
    const heartbeat = setInterval(() => {
      emit("status", getPumpStreamStatus());
      if (!res.writableEnded && !res.destroyed) res.write(": keepalive\n\n");
    }, 15_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      streamClients.delete(res);
    });
  });
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); });
  server.on("close", stopPumpTradeStream);
  server.listen(port, "0.0.0.0", () => console.log(`Server listening on port ${port}`));
}

startServer().catch(error => { console.error(error); process.exit(1); });
