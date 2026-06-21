// Streamable HTTP transport wiring (TS-04 / XPORT-02).
//
// Mounts the SDK's StreamableHTTPServerTransport in STATELESS mode
// (sessionIdGenerator: undefined — no session ID is issued in any response, no
// session validation is performed) on an Express 5 app at POST /mcp. The
// Origin allowlist middleware (security/origin.ts) runs BEFORE the route so no
// disallowed cross-origin request reaches the transport.
//
// Bind defaults to 127.0.0.1 (loopback). Binding to a non-loopback address
// (e.g. 0.0.0.0) exposes the server to the LAN and re-opens the DNS-rebinding
// class — see GHSA-89vp-x53w-74fx
// (https://github.com/modelcontextprotocol/rust-sdk/security/advisories/GHSA-89vp-x53w-74fx);
// the WARN line makes that deviation visible in production logs.
//
// No console.* anywhere in this import graph (enforced by ESLint).

import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type Config } from "../config.js";
import { type Logger } from "../logger.js";
import { originAllowlistMiddleware } from "../security/origin.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * Connect the server over Streamable HTTP. Binds cfg.MCP_HTTP_HOST (default
 * 127.0.0.1) and serves stateless JSON-RPC at POST /mcp.
 */
export async function connectHttp(
  server: McpServer,
  cfg: Config,
  logger: Logger,
): Promise<void> {
  const app = express();
  app.use(express.json());
  // Origin allowlist BEFORE the route — deny-by-default DNS-rebinding defense.
  app.use(originAllowlistMiddleware(cfg, logger));

  app.post("/mcp", async (req, res) => {
    // Fresh transport per request is the stateless pattern: no shared session
    // state, no Mcp-Session-Id header.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      void transport.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const host = cfg.MCP_HTTP_HOST;
  if (!LOOPBACK_HOSTS.has(host)) {
    // Non-loopback bind re-opens the DNS-rebinding surface (GHSA-89vp-x53w-74fx).
    logger.warn(
      { component: "transport_http", data: { host } },
      "http_bound_non_loopback",
    );
  }

  app.listen(cfg.MCP_HTTP_PORT, host, () => {
    logger.info(
      { component: "transport_http", data: { host, port: cfg.MCP_HTTP_PORT } },
      "http_listening",
    );
  });
}
