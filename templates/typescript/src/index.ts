// Entry point (TS-02).
//
// Strict initialization order (ARCHITECTURE §3):
//   1. parse --transport flag (CLI wins over MCP_TRANSPORT env; default stdio)
//   2. loadConfig()  — Zod, fail-fast, BEFORE the logger is bound
//   3. buildLogger() — pino bound to fd 2 BEFORE anything else can log
//   4. buildServer() — McpServer + capabilities + placeholder handlers
//   5. dispatch on transport
//
// In stdio mode, fd 1 carries JSON-RPC ONLY. No console.* anywhere in this
// import graph (enforced by ESLint no-restricted-syntax).

import { type Server as HttpServer } from "node:http";
import { loadConfig } from "./config.js";
import { buildLogger } from "./logger.js";
import { buildServer } from "./server.js";
import { registerShutdown } from "./lifecycle/shutdown.js";
import { connectStdio } from "./transports/stdio.js";
import { connectHttp } from "./transports/http.js";

async function main(): Promise<void> {
  // 1. Transport selection — CLI flag wins over MCP_TRANSPORT env (default stdio).
  const flag = process.argv
    .find((a) => a.startsWith("--transport="))
    ?.split("=")[1];
  if (flag !== undefined) {
    // Let config.ts validate the enum; surface the CLI choice via env so the
    // single Zod schema is the one source of truth for the transport value.
    process.env.MCP_TRANSPORT = flag;
  }

  // 2. Config (fail-fast; exits non-zero on parse error).
  const config = loadConfig();

  // 3. Logger bound to fd 2 before anything else logs.
  const logger = buildLogger(config);

  // 4. Server graph (transport-agnostic).
  const server = buildServer(logger, config);

  // 4b. Register graceful shutdown FIRST — before any transport connects — so
  // the SIGINT/SIGTERM handlers are installed before a request can arrive
  // (HARD-01). The httpServer reference is late-bound: connectHttp() returns the
  // listening socket only after app.listen(), but the handler invokes
  // stopAcceptingNew LAZILY at signal time, so binding it after connect is safe
  // (resolves the registerShutdown ↔ httpServer ordering — W#2). For stdio there
  // is no socket: stopAcceptingNew pauses stdin so no new inbound message is
  // parsed while in-flight work drains.
  let httpServer: HttpServer | undefined;
  registerShutdown({
    server,
    logger,
    graceMs: config.MCP_SHUTDOWN_GRACE_MS,
    stopAcceptingNew: () => {
      if (config.MCP_TRANSPORT === "http") {
        // close() stops accepting NEW connections; active ones keep draining.
        httpServer?.close();
      } else {
        // stdio: no listening socket — stop parsing new inbound messages.
        process.stdin.pause();
      }
    },
  });

  // 5. Dispatch on transport.
  switch (config.MCP_TRANSPORT) {
    case "stdio":
      await connectStdio(server, logger);
      break;
    case "http":
      // Late-bind the http.Server so the (already-registered) shutdown handler
      // can close it at signal time.
      httpServer = await connectHttp(server, config, logger);
      break;
  }
}

main().catch((err: unknown) => {
  // Last-resort failure path — one structured JSON line to fd 2, then exit.
  const line = {
    ts: new Date().toISOString(),
    level: "fatal",
    msg: "startup_failed",
    component: "index",
    data: { error: err instanceof Error ? err.message : String(err) },
  };
  process.stderr.write(JSON.stringify(line) + "\n");
  process.exit(1);
});
