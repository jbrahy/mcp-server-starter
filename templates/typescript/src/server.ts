// MCP server construction + capability advertisement (TS-08).
//
// Declares capabilities in ServerOptions so the SDK answers `initialize` and
// negotiates the protocol version automatically — the template MUST NOT
// hardcode `protocolVersion`; the SDK returns its negotiated value
// (XPORT-06, SMOKE-02).
//
// This slice registers exactly one PLACEHOLDER tool, resource, and prompt so
// the SDK advertises the tools/resources/prompts capabilities at initialize
// (SMOKE-01 requires result.capabilities.{tools,resources,prompts} present).
// The placeholders use a NEUTRAL name (__placeholder) — the real `add` tool /
// example resource / example prompt land in Phase 6.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type Logger } from "./logger.js";
import { type Config } from "./config.js";
import { registerAddTool } from "./tools/add.js";

const SERVER_NAME = "mcp-typescript-template";
const SERVER_VERSION = "0.1.0";

/**
 * Construct the MCP server, advertise capabilities, and register placeholder
 * handlers. Transport-agnostic — the caller wires a transport afterwards.
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

  // Placeholder resource — Phase 6 replaces with the example resource.
  server.registerResource(
    "__placeholder",
    "placeholder://__placeholder",
    {
      title: "Placeholder",
      description:
        "Placeholder resource so the resources capability is advertised at initialize.",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: "placeholder" }],
    }),
  );

  // Placeholder prompt — Phase 6 replaces with the example prompt.
  server.registerPrompt(
    "__placeholder",
    {
      title: "Placeholder",
      description:
        "Placeholder prompt so the prompts capability is advertised at initialize.",
    },
    async () => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: "placeholder" },
        },
      ],
    }),
  );

  logger.info(
    { component: "server", data: { name: SERVER_NAME, version: SERVER_VERSION } },
    "server_constructed",
  );

  return server;
}
