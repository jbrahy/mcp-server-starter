// Stdio transport wiring (TS-03).
//
// The SDK's StdioServerTransport reads fd 0 (stdin) and writes newline-
// delimited JSON-RPC to fd 1 (stdout) — and NOTHING else may touch fd 1.
// The logger (fd 2) must already be bound before connect; no console.* is
// permitted anywhere in this module's import graph (enforced by ESLint).
//
// Request correlation (HARD-04): each inbound JSON-RPC message is dispatched
// inside a fresh per-request ALS scope (one ULID per inbound request, not per
// process). The Protocol layer installs its own `onmessage` during
// `server.connect`, so the wrapper is applied AFTER connect — it captures the
// Protocol's dispatcher and re-invokes it inside runWithCorrelation.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type Logger } from "../logger.js";
import { requestStore, runWithCorrelation } from "../lifecycle/correlation.js";

/** Connect the server over stdio. Stdout carries JSON-RPC only. */
export async function connectStdio(
  server: McpServer,
  logger: Logger,
): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // After connect, transport.onmessage is the Protocol's dispatcher. Wrap it so
  // every inbound message runs inside a fresh correlation scope: stdio has no
  // client header, so request_id is a fresh ULID per request.
  const dispatch = transport.onmessage?.bind(transport);
  transport.onmessage = (message) => {
    runWithCorrelation(undefined, () => {
      const ctx = requestStore.getStore();
      // Log the server-generated internal_request_id once at request start so
      // log search stays reliable (03-observability.md §159-162).
      logger.info(
        {
          component: "transport_stdio",
          data: { internal_request_id: ctx?.internal_request_id },
        },
        "request_received",
      );
      dispatch?.(message);
    });
  };
}
