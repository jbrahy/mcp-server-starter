// Stdio transport wiring (TS-03).
//
// The SDK's StdioServerTransport reads fd 0 (stdin) and writes newline-
// delimited JSON-RPC to fd 1 (stdout) — and NOTHING else may touch fd 1.
// The logger (fd 2) must already be bound before connect; no console.* is
// permitted anywhere in this module's import graph (enforced by ESLint).

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Connect the server over stdio. Stdout carries JSON-RPC only. */
export async function connectStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
