// MCP server construction + capability advertisement (TS-08).
//
// Declares capabilities in ServerOptions so the SDK answers `initialize` and
// negotiates the protocol version automatically — the template MUST NOT
// hardcode `protocolVersion`; the SDK returns its negotiated value
// (XPORT-06, SMOKE-02).
//
// This slice registers the canonical example surface — the `add` tool
// (SURF-01), the example://greeting resource (SURF-02), and the greet prompt
// (SURF-03) — so the SDK advertises the tools/resources/prompts capabilities at
// initialize (SMOKE-01 requires result.capabilities.{tools,resources,prompts}
// present).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type Logger } from "./logger.js";
import { type Config } from "./config.js";
import { registerAddTool } from "./tools/add.js";
import { registerGreetingResource } from "./resources/example.js";
import { registerGreetPrompt } from "./prompts/example.js";

const SERVER_NAME = "mcp-typescript-template";
const SERVER_VERSION = "0.1.0";

/**
 * Construct the MCP server, advertise capabilities, and register the example
 * surface (add tool, greeting resource, greet prompt). Transport-agnostic — the
 * caller wires a transport afterwards.
 */
export function buildServer(logger: Logger, config: Config): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true },
        prompts: { listChanged: true },
        logging: {},
      },
    },
  );

  // The example tool (SURF-01): add(a,b) with progress + cancellation.
  registerAddTool(server, logger, config);

  // The example resource (SURF-02): example://greeting → "Hello from MCP".
  registerGreetingResource(server);

  // The example prompt (SURF-03): greet(name) → "Hello, {name}!".
  registerGreetPrompt(server);

  logger.info(
    { component: "server", data: { name: SERVER_NAME, version: SERVER_VERSION } },
    "server_constructed",
  );

  return server;
}
